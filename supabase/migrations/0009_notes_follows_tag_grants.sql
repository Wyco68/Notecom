-- Follows, granted tags, and tag-implied access.
--
-- The access model changes shape. Tags stop being something you search for and
-- join through, and become a claim someone makes about you:
--
--   1. A follows B          one-sided, A's choice, no approval from B
--   2. B grants tag T to A  allowed only because A follows B
--   3. A accepts T          A now holds T
--   4. folders tagged T     readable by A automatically, no join step
--
-- Every step needs consent from the person gaining the tag: they followed, and
-- they accepted. That is what makes step 4 safe to be automatic — by the time
-- a folder can reach someone, they have opted in twice.
--
-- Manual membership still wins. Tag-implied access is viewer-level only; an
-- explicit notes_folder_members row can grant more (editor) and is what the
-- member list, role changes and removal operate on. Revoking a tag removes
-- implied access everywhere at once, which is the point of granting by tag.
--
-- Retired here: notes_join_by_tag() and notes_suggested_folders(). Both existed
-- to turn a tag into a membership row through a join; there is no join in this
-- model. notes_search_folders() loses its tag filter for the same reason.

begin;

-- --- follows ------------------------------------------------------------------

-- One-sided by design: no acceptance, no reciprocity, no "friend" state.
-- Following someone means "you may put a tag on me", nothing more.
create table if not exists public.notes_follows (
  follower_id uuid        not null references public.profiles(id) on delete cascade,
  followee_id uuid        not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint notes_follows_not_self check (follower_id <> followee_id)
);

create index if not exists notes_follows_followee_idx
  on public.notes_follows (followee_id);

alter table public.notes_follows enable row level security;

-- A user manages their own following list, and can see who follows them (they
-- need that list to know whom they may tag or invite).
drop policy if exists notes_follows_select on public.notes_follows;
create policy notes_follows_select on public.notes_follows
  for select to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));

drop policy if exists notes_follows_insert on public.notes_follows;
create policy notes_follows_insert on public.notes_follows
  for insert to authenticated
  with check (follower_id = (select auth.uid()));

-- Either side may break the edge: you can unfollow, and you can remove a
-- follower you would rather not be able to tag you.
drop policy if exists notes_follows_delete on public.notes_follows;
create policy notes_follows_delete on public.notes_follows
  for delete to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));

create or replace function public.notes_follows_me(p_user uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.notes_follows
     where follower_id = p_user and followee_id = auth.uid()
  );
$$;

-- --- tag grants ---------------------------------------------------------------

-- A pending offer of a tag. Accepting materialises the notes_user_tags row;
-- until then the grantee holds nothing.
create table if not exists public.notes_tag_grants (
  id           uuid        primary key default gen_random_uuid(),
  tag_id       bigint      not null references public.notes_tags(id)  on delete cascade,
  grantee_id   uuid        not null references public.profiles(id)    on delete cascade,
  granter_id   uuid        not null references public.profiles(id)    on delete cascade,
  status       text        not null default 'pending',
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint notes_tag_grants_status_check
    check (status in ('pending', 'accepted', 'declined', 'revoked'))
);

create unique index if not exists notes_tag_grants_pending_uniq
  on public.notes_tag_grants (tag_id, grantee_id) where status = 'pending';
create index if not exists notes_tag_grants_grantee_idx
  on public.notes_tag_grants (grantee_id, status);

alter table public.notes_tag_grants enable row level security;

-- Both parties see the grant; neither writes it directly. Every state change
-- goes through an RPC that re-checks the follow edge and the caller's part in
-- it, so there is deliberately no INSERT or UPDATE policy here.
drop policy if exists notes_tag_grants_select on public.notes_tag_grants;
create policy notes_tag_grants_select on public.notes_tag_grants
  for select to authenticated
  using (grantee_id = (select auth.uid()) or granter_id = (select auth.uid()));

-- --- user tags are granted, never self-assigned -------------------------------

-- Self-insert is withdrawn: a tag is now a claim someone else made, which is
-- what makes it worth anything for access. Users keep the right to drop a tag
-- (the DELETE policy from 0007 stands).
drop policy if exists notes_user_tags_insert on public.notes_user_tags;

create or replace function public.notes_grant_tag(
  p_username text,
  p_label    text
)
returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_grantee uuid;
  v_slug    text;
  v_tag     bigint;
  v_id      uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Unique index is on lower(username), same lookup notes_invite_member uses.
  select id into v_grantee
    from public.profiles
   where lower(username) = lower(trim(p_username));
  if v_grantee is null then
    raise exception 'no such user' using errcode = 'P0002';
  end if;
  if v_grantee = auth.uid() then
    raise exception 'cannot grant a tag to yourself' using errcode = '22023';
  end if;

  -- The follow edge is the permission. Without it this is an unsolicited
  -- claim on a stranger's profile.
  if not public.notes_follows_me(v_grantee) then
    raise exception 'that user does not follow you' using errcode = '42501';
  end if;

  v_slug := lower(regexp_replace(trim(p_label), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  if char_length(v_slug) < 2 then
    raise exception 'tag is too short' using errcode = '22023';
  end if;

  select id into v_tag from public.notes_tags where slug = v_slug;
  if v_tag is null then
    insert into public.notes_tags (slug, label, created_by)
    values (v_slug, left(trim(p_label), 40), auth.uid())
    returning id into v_tag;
  end if;

  -- Already held: nothing to offer.
  if exists (
    select 1 from public.notes_user_tags
     where user_id = v_grantee and tag_id = v_tag
  ) then
    raise exception 'that user already has this tag' using errcode = '22023';
  end if;

  insert into public.notes_tag_grants (tag_id, grantee_id, granter_id)
  values (v_tag, v_grantee, auth.uid())
  on conflict (tag_id, grantee_id) where status = 'pending' do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'that grant is already pending' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

create or replace function public.notes_respond_tag_grant(
  p_grant  uuid,
  p_accept boolean
)
returns text
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_grant public.notes_tag_grants;
begin
  select * into v_grant from public.notes_tag_grants
   where id = p_grant and status = 'pending' for update;

  -- Only the person the tag is about may answer for it.
  if v_grant.id is null or v_grant.grantee_id <> auth.uid() then
    raise exception 'no pending grant' using errcode = 'P0002';
  end if;

  if p_accept then
    insert into public.notes_user_tags (user_id, tag_id)
    values (v_grant.grantee_id, v_grant.tag_id)
    on conflict do nothing;
  end if;

  update public.notes_tag_grants
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now()
   where id = p_grant;

  return case when p_accept then 'accepted' else 'declined' end;
end;
$$;

-- --- tag-implied access -------------------------------------------------------

-- Membership, now including tags: an explicit member row, or a tag the caller
-- holds that this folder carries as an access-granting tag. Implied access is
-- read-only — notes_can_write_folder still reads notes_folder_members, so a
-- tag never confers editing.
create or replace function public.notes_is_folder_member(p_folder uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and exists (
       select 1 from public.notes_folders f
        where f.id = p_folder and f.deleted = false
     )
     and (
       public.notes_folder_role(p_folder) is not null
       or exists (
         select 1
           from public.notes_folder_tags ft
           join public.notes_user_tags ut on ut.tag_id = ft.tag_id
          where ft.folder_id = p_folder
            and ft.grants_join = true
            and ut.user_id = auth.uid()
       )
     );
$$;

-- Folder-level reads follow the same rule, so a folder reached by tag appears
-- in the caller's own lists rather than only its documents being readable.
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
            or public.notes_is_folder_member(p_folder)
          )
     );
$$;

-- --- invitations require a follow --------------------------------------------

-- 0002's function with one added gate. Everything else — the role validation,
-- the lower(username) lookup the unique index expects, the pending-invitation
-- upsert and the join-request cleanup — is carried over verbatim; only the
-- follow check is new.
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

  -- New: you may only reach out to people who chose to follow you. Stops
  -- unsolicited invitations from strangers, the same gate tag granting uses.
  if not public.notes_follows_me(v_invitee) then
    raise exception 'that user does not follow you' using errcode = '42501';
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

-- --- retire the tag-as-discovery surface --------------------------------------

drop function if exists public.notes_join_by_tag(uuid, text);
drop function if exists public.notes_suggested_folders();

-- --- grants -------------------------------------------------------------------

revoke all on public.notes_follows, public.notes_tag_grants from anon;
grant select, insert, delete on public.notes_follows to authenticated;
grant select on public.notes_tag_grants to authenticated;

revoke execute on function
  public.notes_follows_me(uuid),
  public.notes_grant_tag(text, text),
  public.notes_respond_tag_grant(uuid, boolean),
  public.notes_is_folder_member(uuid)
from public, anon;

grant execute on function
  public.notes_follows_me(uuid),
  public.notes_grant_tag(text, text),
  public.notes_respond_tag_grant(uuid, boolean),
  public.notes_is_folder_member(uuid)
to authenticated;

commit;
