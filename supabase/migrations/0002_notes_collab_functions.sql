-- Collaborative folders: predicates and action RPCs.
--
-- The predicates are SECURITY DEFINER for one specific reason: a policy on
-- notes_folder_members that subqueries notes_folder_members recurses. A definer
-- function reads the table with RLS off, which breaks the cycle and lets every
-- policy in 0003 be a single readable expression.
--
-- The action RPCs are the ONLY writers of notes_folder_members — that table has
-- no INSERT policy at all. Because RLS is off inside a definer body, each RPC
-- re-establishes the caller and re-checks authorization before touching a row.
-- Every one pins search_path so a caller-controlled path cannot redirect a
-- lookup.

begin;

-- --- predicates ---------------------------------------------------------------

create or replace function public.notes_folder_role(p_folder uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role
    from public.notes_folder_members m
   where m.folder_id = p_folder
     and m.user_id = auth.uid();
$$;

create or replace function public.notes_can_read_folder(p_folder uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and exists (
       select 1
         from public.notes_folders f
        where f.id = p_folder
          and f.deleted = false
          and (
            f.visibility = 'public'
            or public.notes_folder_role(p_folder) is not null
          )
     );
$$;

create or replace function public.notes_can_write_folder(p_folder uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select r.can_write
       from public.notes_folder_roles r
      where r.role = public.notes_folder_role(p_folder)),
    false
  );
$$;

create or replace function public.notes_can_manage_folder(p_folder uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select r.can_manage
       from public.notes_folder_roles r
      where r.role = public.notes_folder_role(p_folder)),
    false
  );
$$;

-- What the local `stored` sidecar reads to learn its own role per folder, so
-- the desktop can grey out write controls. security_invoker: the member-table
-- policy decides what the caller sees, the view adds no authority of its own.
create or replace view public.notes_folder_access
with (security_invoker = on) as
  select folder_id, role
    from public.notes_folder_members
   where user_id = auth.uid();

-- --- membership actions -------------------------------------------------------

create or replace function public.notes_invite_member(
  p_folder   uuid,
  p_username text,
  p_role     text default 'viewer'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_invitee uuid;
  v_id      uuid;
begin
  if not public.notes_can_manage_folder(p_folder) then
    raise exception 'not authorized to manage this folder' using errcode = '42501';
  end if;

  if p_role = 'owner' or not exists (select 1 from public.notes_folder_roles where role = p_role) then
    raise exception 'invalid role: %', p_role using errcode = '22023';
  end if;

  -- Resolved in here so member search never needs a broad SELECT policy on
  -- profiles. Unique index is on lower(username).
  select id into v_invitee
    from public.profiles
   where lower(username) = lower(trim(p_username));

  if v_invitee is null then
    raise exception 'no such user' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.notes_folder_members
              where folder_id = p_folder and user_id = v_invitee) then
    raise exception 'already a member' using errcode = '23505';
  end if;

  insert into public.notes_folder_invitations (folder_id, invitee_id, inviter_id, role)
  values (p_folder, v_invitee, auth.uid(), p_role)
  on conflict (folder_id, invitee_id) where status = 'pending'
  do update set role = excluded.role, created_at = now()
  returning id into v_id;

  -- An open join request from the same user is now moot.
  update public.notes_folder_join_requests
     set status = 'approved', decided_by = auth.uid(), decided_at = now()
   where folder_id = p_folder and user_id = v_invitee and status = 'pending';

  return v_id;
end;
$$;

create or replace function public.notes_respond_invitation(
  p_invitation uuid,
  p_accept     boolean
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.notes_folder_invitations;
begin
  -- Scoped to the caller as the invitee: an owner cannot accept on someone's
  -- behalf, and a third party cannot see the row at all.
  select * into v_inv
    from public.notes_folder_invitations
   where id = p_invitation
     and invitee_id = auth.uid()
     and status = 'pending'
   for update;

  if v_inv.id is null then
    raise exception 'no pending invitation' using errcode = 'P0002';
  end if;

  if p_accept then
    insert into public.notes_folder_members (folder_id, user_id, role)
    values (v_inv.folder_id, v_inv.invitee_id, v_inv.role)
    on conflict (folder_id, user_id) do nothing;
  end if;

  update public.notes_folder_invitations
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now()
   where id = p_invitation;

  return case when p_accept then 'accepted' else 'declined' end;
end;
$$;

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

  -- A folder the caller cannot discover must not even confirm its existence.
  if v_folder.id is null or (v_folder.discoverable = false
                             and public.notes_folder_role(p_folder) is null) then
    raise exception 'no such folder' using errcode = 'P0002';
  end if;

  if public.notes_folder_role(p_folder) is not null then
    return 'joined';
  end if;

  if v_folder.join_policy = 'open' then
    insert into public.notes_folder_members (folder_id, user_id, role)
    values (p_folder, auth.uid(), 'viewer')
    on conflict (folder_id, user_id) do nothing;
    return 'joined';
  end if;

  if v_folder.join_policy = 'invite_only' then
    raise exception 'this folder is invite only' using errcode = '42501';
  end if;

  insert into public.notes_folder_join_requests (folder_id, user_id, message)
  values (p_folder, auth.uid(), nullif(trim(coalesce(p_message, '')), ''))
  on conflict (folder_id, user_id) where status = 'pending'
  do update set message = excluded.message, created_at = now();

  return 'requested';
end;
$$;

create or replace function public.notes_join_by_tag(
  p_folder uuid,
  p_tag    text
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ok boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- The grant lives on the folder-tag edge, so joining this way requires both
  -- that the folder is discoverable and that this specific tag opens the door.
  select true into v_ok
    from public.notes_folders f
    join public.notes_folder_tags ft on ft.folder_id = f.id
    join public.notes_tags t on t.id = ft.tag_id
   where f.id = p_folder
     and f.deleted = false
     and f.discoverable = true
     and ft.grants_join = true
     and t.slug = lower(trim(p_tag));

  if not coalesce(v_ok, false) then
    raise exception 'this tag does not grant access to that folder' using errcode = '42501';
  end if;

  insert into public.notes_folder_members (folder_id, user_id, role)
  values (p_folder, auth.uid(), 'viewer')
  on conflict (folder_id, user_id) do nothing;

  return 'joined';
end;
$$;

create or replace function public.notes_respond_join_request(
  p_request uuid,
  p_approve boolean
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_req public.notes_folder_join_requests;
begin
  select * into v_req
    from public.notes_folder_join_requests
   where id = p_request and status = 'pending'
   for update;

  if v_req.id is null or not public.notes_can_manage_folder(v_req.folder_id) then
    raise exception 'no pending request' using errcode = 'P0002';
  end if;

  if p_approve then
    insert into public.notes_folder_members (folder_id, user_id, role)
    values (v_req.folder_id, v_req.user_id, 'viewer')
    on conflict (folder_id, user_id) do nothing;
  end if;

  update public.notes_folder_join_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_request;

  return case when p_approve then 'approved' else 'rejected' end;
end;
$$;

create or replace function public.notes_set_member_role(
  p_folder uuid,
  p_user   uuid,
  p_role   text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.notes_can_manage_folder(p_folder) then
    raise exception 'not authorized to manage this folder' using errcode = '42501';
  end if;

  if p_role = 'owner' or not exists (select 1 from public.notes_folder_roles where role = p_role) then
    raise exception 'invalid role: %', p_role using errcode = '22023';
  end if;

  -- Owners are demoted by transferring the folder, never by a role edit —
  -- otherwise a folder could end up with no manager.
  if exists (select 1 from public.notes_folders where id = p_folder and owner_id = p_user) then
    raise exception 'cannot change the owner''s role' using errcode = '42501';
  end if;

  update public.notes_folder_members
     set role = p_role
   where folder_id = p_folder and user_id = p_user;

  if not found then
    raise exception 'not a member' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.notes_remove_member(
  p_folder uuid,
  p_user   uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.notes_can_manage_folder(p_folder) then
    raise exception 'not authorized to manage this folder' using errcode = '42501';
  end if;

  if exists (select 1 from public.notes_folders where id = p_folder and owner_id = p_user) then
    raise exception 'cannot remove the owner' using errcode = '42501';
  end if;

  delete from public.notes_folder_members
   where folder_id = p_folder and user_id = p_user;
end;
$$;

create or replace function public.notes_leave_folder(p_folder uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.notes_folders where id = p_folder and owner_id = auth.uid()) then
    raise exception 'the owner cannot leave; transfer or delete the folder' using errcode = '42501';
  end if;

  delete from public.notes_folder_members
   where folder_id = p_folder and user_id = auth.uid();
end;
$$;

-- --- discovery ----------------------------------------------------------------

-- The discoverability rule lives here, in SQL: a folder the caller is not a
-- member of appears only when discoverable = true. Private-but-discoverable
-- folders return metadata; their documents stay unreadable (0003).
create or replace function public.notes_search_folders(
  p_q      text    default null,
  p_tags   text[]  default null,
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
    select nullif(trim(coalesce(p_q, '')), '') as term,
           case when p_tags is null or cardinality(p_tags) = 0 then null
                else (select array_agg(lower(trim(t))) from unnest(p_tags) t)
           end as tags
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
     and (q.tags is null or coalesce(ft.tags, '{}') && q.tags)
     and (
       q.term is null
       or f.search_tsv @@ plainto_tsquery('simple', q.term)
       or f.name ilike '%' || q.term || '%'
       or f.description ilike '%' || q.term || '%'
       or p.username ilike '%' || q.term || '%'
       or coalesce(ft.tags, '{}') && array[lower(q.term)]
     )
   order by (public.notes_folder_role(f.id) is not null) desc, f.created_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 100))
   offset greatest(0, coalesce(p_offset, 0));
$$;

-- --- grants -------------------------------------------------------------------

-- Definer functions default to EXECUTE for PUBLIC. Each body already refuses an
-- anonymous caller, but revoking is the cheaper guarantee.
revoke execute on function
  public.notes_invite_member(uuid, text, text),
  public.notes_respond_invitation(uuid, boolean),
  public.notes_request_join(uuid, text),
  public.notes_join_by_tag(uuid, text),
  public.notes_respond_join_request(uuid, boolean),
  public.notes_set_member_role(uuid, uuid, text),
  public.notes_remove_member(uuid, uuid),
  public.notes_leave_folder(uuid),
  public.notes_search_folders(text, text[], integer, integer)
from public, anon;

grant execute on function
  public.notes_invite_member(uuid, text, text),
  public.notes_respond_invitation(uuid, boolean),
  public.notes_request_join(uuid, text),
  public.notes_join_by_tag(uuid, text),
  public.notes_respond_join_request(uuid, boolean),
  public.notes_set_member_role(uuid, uuid, text),
  public.notes_remove_member(uuid, uuid),
  public.notes_leave_folder(uuid),
  public.notes_search_folders(text, text[], integer, integer)
to authenticated;

commit;
