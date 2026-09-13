-- Tags as topics: visible to anyone who can see the folder, and searchable.
--
-- While a tag was a credential (0020) its presence on a folder was itself
-- sensitive, so the tag list was filtered down to tags the viewer held, and
-- search refused to match on one. Neither reason survives 0026: a tag grants
-- nothing now, so "which folders carry #os" is exactly the question a topic
-- exists to answer.

begin;

-- One rule: see the folder, see its topics.
drop policy if exists notes_folder_tags_select on public.notes_folder_tags;
create policy notes_folder_tags_select on public.notes_folder_tags
  for select to authenticated
  using (
    exists (
      select 1 from public.notes_folders f
       where f.id = notes_folder_tags.folder_id
         and f.deleted = false
         and public.notes_can_read_folder(f.id)
    )
  );

-- Discovery: the holder filter goes from the tag lateral, and a term now also
-- matches a topic slug. Signature unchanged, so callers are untouched.
create or replace function public.notes_search_folders(
  p_q text default null, p_limit integer default 20, p_offset integer default 0)
returns table (
  id uuid, slug text, name text, description text, visibility text, join_policy text,
  owner_id uuid, owner_username text, owner_avatar text,
  tags text[], join_tags text[], member_count bigint, document_count bigint,
  my_role text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  with q as (
    select nullif(trim(coalesce(p_q, '')), '') as term
  )
  select f.id, f.slug, f.name, f.description, f.visibility, f.join_policy,
         f.owner_id, p.username, p.avatar_url,
         coalesce(ft.tags, '{}'), coalesce(ft.tags, '{}'),
         coalesce(mc.n, 0), coalesce(dc.n, 0),
         public.notes_folder_role(f.id), f.created_at
    from public.notes_folders f
    join public.profiles p on p.id = f.owner_id
    cross join q
    left join lateral (
      select array_agg(t.slug order by t.slug) as tags
        from public.notes_folder_tags x
        join public.notes_tags t on t.id = x.tag_id
       where x.folder_id = f.id
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
       or exists (
         select 1 from public.notes_folder_tags x
           join public.notes_tags t on t.id = x.tag_id
          where x.folder_id = f.id
            and t.slug ilike '%' || ltrim(q.term, '#') || '%'
       )
     )
   order by public.notes_is_folder_member(f.id) desc, f.created_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 100))
   offset greatest(0, coalesce(p_offset, 0));
$$;

-- The caller's folders: membership rows only (0026), topics unfiltered.
-- `join_tags` is kept in the shape for compatibility and mirrors `tags`.
create or replace function public.notes_my_folders()
returns table (
  id uuid, slug text, name text, description text, visibility text, join_policy text,
  owner_id uuid, owner_username text, owner_avatar text,
  tags text[], join_tags text[], member_count bigint, document_count bigint,
  my_role text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select f.id, f.slug, f.name, f.description, f.visibility, f.join_policy,
         f.owner_id, p.username, p.avatar_url,
         coalesce(ft.tags, '{}'), coalesce(ft.tags, '{}'),
         coalesce(mc.n, 0), coalesce(dc.n, 0),
         m.role, f.created_at
    from public.notes_folder_members m
    join public.notes_folders f on f.id = m.folder_id and f.deleted = false
    join public.profiles p on p.id = f.owner_id
    left join lateral (
      select array_agg(t.slug order by t.slug) as tags
        from public.notes_folder_tags x
        join public.notes_tags t on t.id = x.tag_id
       where x.folder_id = f.id
    ) ft on true
    left join lateral (
      select count(*) as n from public.notes_folder_members mm where mm.folder_id = f.id
    ) mc on true
    left join lateral (
      select count(*) as n from public.notes_documents d
       where d.folder_id = f.id and d.deleted = false
    ) dc on true
   where m.user_id = auth.uid()
   order by f.name;
$$;

commit;
