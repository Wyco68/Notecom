-- notes_my_folders: the caller's own folders, without scanning the world.
--
-- lib/collab/folders.ts previously fetched up to 100 discoverable folders and
-- filtered them client-side to those the user belongs to — correct under RLS
-- but wasteful, and silently wrong once the user has folders that rank past
-- the 100-row window. This joins membership directly, so the result is exactly
-- the caller's folders. Columns match notes_search_folders so the app maps
-- both with one function.

begin;

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
         coalesce(ft.tags, '{}'), coalesce(ft.join_tags, '{}'),
         coalesce(mc.n, 0), coalesce(dc.n, 0),
         mine.role, f.created_at
    from public.notes_folder_members mine
    join public.notes_folders f on f.id = mine.folder_id and f.deleted = false
    join public.profiles p on p.id = f.owner_id
    left join lateral (
      select array_agg(t.slug order by t.slug) as tags,
             array_agg(t.slug order by t.slug) filter (where x.grants_join) as join_tags
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
   where mine.user_id = auth.uid()
   order by f.name;
$$;

revoke execute on function public.notes_my_folders() from public, anon;
grant execute on function public.notes_my_folders() to authenticated;

commit;
