-- Bug fix: a folder reachable only via a held grants_join tag was invisible
-- everywhere except direct document reads. notes_is_folder_member() already
-- accounted for tag-implied access; three read paths did not:
--   1. notes_folders_select (the base table's own RLS policy) checked only
--      for an explicit notes_folder_members row via notes_folder_role().
--   2. notes_search_folders() repeated that same narrower condition in its
--      own WHERE clause (SECURITY DEFINER, so it never inherited the
--      table's policy regardless).
--   3. notes_my_folders() inner-joined from notes_folder_members directly,
--      which structurally excludes a tag-implied "member" since there is no
--      membership row to join from.
--
-- Product change bundled in: every folder-tag association now grants
-- joining -- the per-tag grants_join toggle is retired as a product concept
-- (the app stops offering a way to set it false). The column survives
-- (dropping it is not worth a migration, matching the discoverable/
-- join_policy precedent -- docs/collaboration.md); notes_is_folder_member()
-- keeps checking grants_join = true as harmless redundancy rather than being
-- simplified away, since every row will read true from here on anyway.

-- Backfill: every existing folder-tag row grants joining from here on.
update public.notes_folder_tags set grants_join = true where grants_join = false;

-- 1. notes_folders_select: add the tag-implied path.
--
-- Kept as an OR with notes_folder_role(id) IS NOT NULL rather than a bare
-- notes_can_read_folder(id), to preserve the documented tombstone asymmetry
-- (docs/collaboration.md, "Tombstones and visibility"): an explicit member
-- must still see their own folder's tombstone (deleted = true) so a client
-- can tell "removed" from "never existed". notes_can_read_folder()
-- deliberately excludes deleted rows for everyone, including tag-implied
-- readers, which is correct -- a tombstoned folder should stop granting
-- tag-implied access, not keep granting it.
drop policy if exists notes_folders_select on public.notes_folders;
create policy notes_folders_select on public.notes_folders
  for select
  using (
    notes_folder_role(id) is not null
    or notes_can_read_folder(id)
  );

-- 2. notes_search_folders(): read through notes_can_read_folder() instead of
-- repeating a narrower membership-only condition, so a tag-implied reader is
-- included exactly like discovery already intends for public folders. The
-- ordering now sorts by notes_is_folder_member() (true for an explicit member
-- *or* a tag-implied one) instead of notes_folder_role() (explicit members
-- only), so a tag-implied folder sorts with the caller's real folders rather
-- than with public strangers'.
--
-- Also bundled: a folder's tags/join_tags arrays are now filtered to what the
-- caller may see -- the folder's manager sees every tag, everyone else only
-- the tags they personally hold (a notes_user_tags row for that tag_id).
create or replace function public.notes_search_folders(p_q text default null, p_limit integer default 20, p_offset integer default 0)
returns table(id uuid, slug text, name text, description text, visibility text, join_policy text, owner_id uuid, owner_username text, owner_avatar text, tags text[], join_tags text[], member_count bigint, document_count bigint, my_role text, created_at timestamptz)
language sql
stable security definer
set search_path = public, pg_temp
as $$
  with q as (
    select nullif(trim(coalesce(p_q, '')), '') as term
  )
  select f.id,
         f.slug,
         f.name,
         f.description,
         f.visibility,
         f.join_policy,
         f.owner_id,
         p.username,
         p.avatar_url,
         coalesce(ft.tags, '{}'),
         coalesce(ft.join_tags, '{}'),
         coalesce(mc.n, 0),
         coalesce(dc.n, 0),
         public.notes_folder_role(f.id),
         f.created_at
    from public.notes_folders f
    join public.profiles p on p.id = f.owner_id
    cross join q
    left join lateral (
      select array_agg(t.slug order by t.slug) as tags,
             array_agg(t.slug order by t.slug) filter (where x.grants_join) as join_tags
        from public.notes_folder_tags x
        join public.notes_tags t on t.id = x.tag_id
       where x.folder_id = f.id
         and (
           public.notes_can_manage_folder(f.id)
           or exists (
             select 1 from public.notes_user_tags ut
              where ut.tag_id = x.tag_id and ut.user_id = auth.uid()
           )
         )
    ) ft on true
    left join lateral (
      select count(*) as n from public.notes_folder_members m where m.folder_id = f.id
    ) mc on true
    left join lateral (
      select count(*) as n from public.notes_documents d
       where d.folder_id = f.id and d.deleted = false
    ) dc on true
   where auth.uid() is not null
     and f.deleted = false
     and public.notes_can_read_folder(f.id)
     and (
       q.term is null
       or f.search_tsv @@ plainto_tsquery('simple', q.term)
       or f.name ilike '%' || q.term || '%'
       or f.description ilike '%' || q.term || '%'
       or p.username ilike '%' || q.term || '%'
     )
   order by public.notes_is_folder_member(f.id) desc, f.created_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 100))
   offset greatest(0, coalesce(p_offset, 0));
$$;

-- 3. notes_my_folders(): real rewrite, not a WHERE-clause tweak. Includes a
-- folder reachable via an explicit notes_folder_members row *or* a held
-- grants_join tag, each folder exactly once (the left join to the caller's
-- own membership row is at most one row, keyed by the (folder_id, user_id)
-- primary key, so there is nothing to dedupe). my_role is the real role for
-- an explicit member, null for a tag-implied-only folder -- there is no role
-- in that case, matching FolderSummary.myRole's nullable type. Same
-- manager-sees-all / everyone-else-sees-only-held-tags filter as
-- notes_search_folders() above.
create or replace function public.notes_my_folders()
returns table(id uuid, slug text, name text, description text, visibility text, join_policy text, owner_id uuid, owner_username text, owner_avatar text, tags text[], join_tags text[], member_count bigint, document_count bigint, my_role text, created_at timestamptz)
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select f.id, f.slug, f.name, f.description, f.visibility, f.join_policy,
         f.owner_id, p.username, p.avatar_url,
         coalesce(ft.tags, '{}'), coalesce(ft.join_tags, '{}'),
         coalesce(mc.n, 0), coalesce(dc.n, 0),
         m.role,
         f.created_at
    from public.notes_folders f
    join public.profiles p on p.id = f.owner_id
    left join public.notes_folder_members m
           on m.folder_id = f.id and m.user_id = auth.uid()
    left join lateral (
      select array_agg(t.slug order by t.slug) as tags,
             array_agg(t.slug order by t.slug) filter (where x.grants_join) as join_tags
        from public.notes_folder_tags x
        join public.notes_tags t on t.id = x.tag_id
       where x.folder_id = f.id
         and (
           public.notes_can_manage_folder(f.id)
           or exists (
             select 1 from public.notes_user_tags ut
              where ut.tag_id = x.tag_id and ut.user_id = auth.uid()
           )
         )
    ) ft on true
    left join lateral (
      select count(*) as n from public.notes_folder_members mm where mm.folder_id = f.id
    ) mc on true
    left join lateral (
      select count(*) as n from public.notes_documents d
       where d.folder_id = f.id and d.deleted = false
    ) dc on true
   where f.deleted = false
     and (
       m.user_id is not null
       or exists (
         select 1
           from public.notes_folder_tags ft2
           join public.notes_user_tags ut2 on ut2.tag_id = ft2.tag_id
          where ft2.folder_id = f.id
            and ft2.grants_join = true
            and ut2.user_id = auth.uid()
       )
     )
   order by f.name;
$$;
