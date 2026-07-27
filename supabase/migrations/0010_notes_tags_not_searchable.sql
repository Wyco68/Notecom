-- Tags stop being searchable.
--
-- With 0009, holding a tag grants read access to every folder carrying it. That
-- makes a tag a credential, and a credential must not double as a search key:
-- being able to look up "which folders does ISNE3RD open" hands an attacker the
-- exact list of things worth acquiring that tag for.
--
-- So notes_search_folders loses both tag paths — the p_tags filter and the
-- free-text match against a folder's tag list. Discovery is now name,
-- description and owner only. Folder tags remain visible on a folder you can
-- already read; they just stop being a way to find one.
--
-- The argument list changes, so the old function is dropped rather than
-- replaced. lib/collab/folders.ts is updated in the same change.

begin;

drop function if exists public.notes_search_folders(text, text[], integer, integer);

create or replace function public.notes_search_folders(
  p_q      text    default null,
  p_limit  integer default 20,
  p_offset integer default 0
)
returns table (
  id             uuid,
  slug           text,
  name           text,
  description    text,
  visibility     text,
  join_policy    text,
  owner_id       uuid,
  owner_username text,
  owner_avatar   text,
  tags           text[],
  join_tags      text[],
  member_count   bigint,
  document_count bigint,
  my_role        text,
  created_at     timestamptz
)
language sql
stable
security definer
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
     and (f.discoverable = true or public.notes_folder_role(f.id) is not null)
     and (
       q.term is null
       or f.search_tsv @@ plainto_tsquery('simple', q.term)
       or f.name ilike '%' || q.term || '%'
       or f.description ilike '%' || q.term || '%'
       or p.username ilike '%' || q.term || '%'
     )
   order by (public.notes_folder_role(f.id) is not null) desc, f.created_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 100))
   offset greatest(0, coalesce(p_offset, 0));
$$;

revoke execute on function public.notes_search_folders(text, integer, integer)
  from public, anon;
grant execute on function public.notes_search_folders(text, integer, integer)
  to authenticated;

commit;
