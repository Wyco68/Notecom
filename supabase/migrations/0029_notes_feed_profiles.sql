-- The home feed and public profiles.
--
-- The feed shows only what the caller can already read. Two kinds of item:
--   doc    — a lesson or quiz added to a folder the caller is a member of;
--   folder — a public folder created by someone the caller follows (accepted).
-- A folder item carries folder metadata only, which `notes_can_read_folder`
-- already exposes; a document title from a folder the caller is not in never
-- appears, because membership is the gate on files (0026).
--
-- Keyset pagination on the item time: pass the oldest `at` you have as
-- `p_before` to get the next page. Each branch is limited before the union so
-- neither can scan unbounded.

begin;

create index if not exists notes_documents_folder_created_idx
  on public.notes_documents (folder_id, created_at desc)
  where deleted = false;

create index if not exists notes_follows_follower_accepted_idx
  on public.notes_follows (follower_id)
  where status = 'accepted';

create or replace function public.notes_feed(
  p_before timestamptz default null, p_limit integer default 20)
returns table (
  item_kind text, at timestamptz,
  doc_kind text, doc_key text, doc_title text,
  folder_id uuid, folder_slug text, folder_name text, folder_description text,
  owner_username text, owner_avatar text)
language sql stable security definer set search_path = public, pg_temp
as $$
  with lim as (
    select greatest(1, least(coalesce(p_limit, 20), 50)) as n
  ),
  docs as (
    select 'doc'::text, d.created_at, d.kind, d.doc_key, d.title,
           f.id, f.slug, f.name, null::text,
           p.username, p.avatar_url
      from public.notes_folder_members m
      join public.notes_documents d on d.folder_id = m.folder_id and d.deleted = false
      join public.notes_folders f on f.id = m.folder_id and f.deleted = false
      join public.profiles p on p.id = f.owner_id
     where m.user_id = auth.uid()
       and (p_before is null or d.created_at < p_before)
     order by d.created_at desc
     limit (select n from lim)
  ),
  folders as (
    select 'folder'::text, f.created_at, null::text, null::text, null::text,
           f.id, f.slug, f.name, f.description,
           p.username, p.avatar_url
      from public.notes_follows fo
      join public.notes_folders f
        on f.owner_id = fo.followee_id and f.deleted = false and f.visibility = 'public'
      join public.profiles p on p.id = f.owner_id
     where fo.follower_id = auth.uid()
       and fo.status = 'accepted'
       and (p_before is null or f.created_at < p_before)
     order by f.created_at desc
     limit (select n from lim)
  )
  select * from (select * from docs union all select * from folders) x
   where auth.uid() is not null
   order by 2 desc
   limit (select n from lim);
$$;

revoke execute on function public.notes_feed(timestamptz, integer) from public, anon;
grant execute on function public.notes_feed(timestamptz, integer) to authenticated;

-- One person's header: counts are accepted follows only, and follow_state is
-- the caller's own edge toward them.
create or replace function public.notes_profile(p_username text)
returns table (
  user_id uuid, username text, avatar_url text,
  followers bigint, following bigint, public_folders bigint,
  follow_state text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select p.id, p.username, p.avatar_url,
         (select count(*) from public.notes_follows
           where followee_id = p.id and status = 'accepted'),
         (select count(*) from public.notes_follows
           where follower_id = p.id and status = 'accepted'),
         (select count(*) from public.notes_folders f
           where f.owner_id = p.id and f.deleted = false and f.visibility = 'public'),
         case
           when p.id = auth.uid() then 'self'
           else coalesce(
             (select status from public.notes_follows
               where follower_id = auth.uid() and followee_id = p.id),
             'none')
         end
    from public.profiles p
   where auth.uid() is not null
     and lower(p.username) = lower(trim(p_username));
$$;

revoke execute on function public.notes_profile(text) from public, anon;
grant execute on function public.notes_profile(text) to authenticated;

-- One person's folders, in the discovery shape so the app maps both with one
-- function: what the caller can see of theirs — public ones, plus private ones
-- the caller is a member of. Featured first.
create or replace function public.notes_user_folders(
  p_username text, p_limit integer default 20, p_offset integer default 0)
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
         public.notes_folder_role(f.id), f.created_at
    from public.notes_folders f
    join public.profiles p on p.id = f.owner_id
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
     and lower(p.username) = lower(trim(p_username))
     and public.notes_can_read_folder(f.id)
   order by f.featured desc, f.created_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 100))
   offset greatest(0, coalesce(p_offset, 0));
$$;

revoke execute on function public.notes_user_folders(text, integer, integer) from public, anon;
grant execute on function public.notes_user_folders(text, integer, integer) to authenticated;

commit;
