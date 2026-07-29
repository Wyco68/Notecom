-- Discoverability and join policy are retired as product concepts.
--
-- Two axes collapse into one: a folder is either public (listed in search) or
-- private (invisible to non-members). "Discoverable" only ever restated that,
-- and a public-but-hidden folder was a state nobody asked for. Likewise there
-- is now exactly one way in — a join request the owner approves — so 'open'
-- (instant join) and 'invite_only' (no request at all) both go.
--
-- The columns themselves stay, defaulted and unread: `stored` still ships them
-- in its sync payload (tools/stored/sync.go), and dropping them here would
-- break every push from an older sidecar. Nothing in the database consults
-- them after this migration; the app no longer sends them either.
--
-- Migration safety: a folder that was deliberately hidden becomes private
-- rather than suddenly listed. A migration must never publish anything that
-- was previously unshared — same rule 0001 followed.

begin;

update public.notes_folders
   set visibility = 'private'
 where discoverable = false
   and visibility = 'public';

update public.notes_folders
   set join_policy = 'request'
 where join_policy <> 'request';

alter table public.notes_folders
  alter column discoverable set default true,
  alter column join_policy  set default 'request';

-- --- policies: visibility is the only axis now --------------------------------

-- Members still see their folders including tombstones (`stored` needs the
-- tombstone to replicate a delete). Everyone else sees live public folders,
-- metadata only — the documents policy is what guards content.
drop policy if exists notes_folders_select on public.notes_folders;
create policy notes_folders_select on public.notes_folders
  for select to authenticated
  using (
    public.notes_folder_role(id) is not null
    or (deleted = false and visibility = 'public')
  );

-- A folder's tags are visible exactly when the folder is.
drop policy if exists notes_folder_tags_select on public.notes_folder_tags;
create policy notes_folder_tags_select on public.notes_folder_tags
  for select to authenticated
  using (
    exists (
      select 1 from public.notes_folders f
       where f.id = folder_id
         and f.deleted = false
         and public.notes_can_read_folder(f.id)
    )
  );

-- --- joining: one path, always approved by the owner --------------------------

create or replace function public.notes_request_join(
  p_folder  uuid,
  p_message text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_folder public.notes_folders;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_folder
    from public.notes_folders
   where id = p_folder and deleted = false;

  -- A folder the caller cannot see must not even confirm its existence.
  if v_folder.id is null
     or (v_folder.visibility <> 'public'
         and public.notes_folder_role(p_folder) is null) then
    raise exception 'no such folder' using errcode = 'P0002';
  end if;

  if public.notes_folder_role(p_folder) is not null then
    return 'joined';
  end if;

  insert into public.notes_folder_join_requests (folder_id, user_id, message)
  values (p_folder, auth.uid(), nullif(trim(coalesce(p_message, '')), ''))
  on conflict (folder_id, user_id) where status = 'pending'
  do update set message = excluded.message, created_at = now();

  return 'requested';
end;
$$;

-- --- discovery: public folders, plus the caller's own -------------------------

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
     and (f.visibility = 'public' or public.notes_folder_role(f.id) is not null)
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
