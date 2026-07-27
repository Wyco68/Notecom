-- User tags, folder suggestions, and ownership transfer.
--
-- Tags already existed on folders (notes_folder_tags, with the per-tag
-- grants_join flag). What was missing is the other half of the edge: a tag on
-- a *user*. With both sides tagged, a folder can be suggested to the people it
-- is meant for — "you carry ISNE3RD, this folder is tagged ISNE3RD".
--
-- Deliberately NOT a new permission system. notes_can_read_folder() is
-- untouched. A matching tag only surfaces a suggestion; joining still goes
-- through notes_join_by_tag(), which already requires the folder to be
-- discoverable AND that specific tag to carry grants_join, and which inserts
-- an ordinary 'viewer' membership row. So:
--
--   * a suggestion grants nothing on its own — the user chooses to join
--   * an explicit member row always wins, because a tag join can only ever
--     produce 'viewer' and never upgrades an existing row
--   * revoking access stays one thing: remove the member row
--
-- Ownership transfer lands here too: it is the one manage-level action the
-- folder settings page could not express, and it needs a SECURITY DEFINER
-- function because it rewrites two member rows and the folder in one step.

begin;

-- --- user tags ----------------------------------------------------------------

create table if not exists public.notes_user_tags (
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  tag_id     bigint      not null references public.notes_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, tag_id)
);

create index if not exists notes_user_tags_tag_idx
  on public.notes_user_tags (tag_id);

alter table public.notes_user_tags enable row level security;

-- A user's tags are their own: they read, add and remove only their own rows.
-- There is deliberately no UPDATE policy — a tag is added or removed, never
-- mutated in place (same reasoning as notes_folder_members).
drop policy if exists notes_user_tags_select on public.notes_user_tags;
create policy notes_user_tags_select on public.notes_user_tags
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists notes_user_tags_insert on public.notes_user_tags;
create policy notes_user_tags_insert on public.notes_user_tags
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists notes_user_tags_delete on public.notes_user_tags;
create policy notes_user_tags_delete on public.notes_user_tags
  for delete to authenticated using (user_id = (select auth.uid()));

-- --- suggestions --------------------------------------------------------------

-- Folders worth offering to the caller: they share a tag, that tag opens the
-- door, and the caller is not already involved. Columns match
-- notes_search_folders/notes_my_folders (one mapper in the app) plus the
-- matching tag, which the caller must pass back to notes_join_by_tag.
create or replace function public.notes_suggested_folders()
returns table (
  id uuid, slug text, name text, description text, visibility text, join_policy text,
  owner_id uuid, owner_username text, owner_avatar text,
  tags text[], join_tags text[], member_count bigint, document_count bigint,
  my_role text, created_at timestamptz, matched_tag text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select f.id, f.slug, f.name, f.description, f.visibility, f.join_policy,
         f.owner_id, p.username, p.avatar_url,
         coalesce(ft.tags, '{}'), coalesce(ft.join_tags, '{}'),
         coalesce(mc.n, 0), coalesce(dc.n, 0),
         null::text, f.created_at, m.matched_tag
    from public.notes_folders f
    join public.profiles p on p.id = f.owner_id
    -- The match: one row per folder, carrying the alphabetically-first tag
    -- that both the caller and the folder hold and that grants joining.
    join lateral (
      select min(t.slug) as matched_tag
        from public.notes_folder_tags x
        join public.notes_tags t on t.id = x.tag_id
        join public.notes_user_tags ut
          on ut.tag_id = x.tag_id and ut.user_id = (select auth.uid())
       where x.folder_id = f.id
         and x.grants_join = true
    ) m on m.matched_tag is not null
    left join lateral (
      select array_agg(t.slug order by t.slug) as tags,
             array_agg(t.slug order by t.slug) filter (where x.grants_join) as join_tags
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
   where (select auth.uid()) is not null
     and f.deleted = false
     -- Same gate notes_join_by_tag enforces; suggesting a folder the join
     -- would refuse is worse than not suggesting it.
     and f.discoverable = true
     and not exists (
       select 1 from public.notes_folder_members me
        where me.folder_id = f.id and me.user_id = (select auth.uid())
     )
     -- Already asked to join: the answer is pending, not this prompt again.
     and not exists (
       select 1 from public.notes_folder_join_requests r
        where r.folder_id = f.id and r.user_id = (select auth.uid())
          and r.status = 'pending'
     )
   order by f.name;
$$;

-- --- ownership transfer -------------------------------------------------------

-- Owners transfer or delete; they are never removed or demoted by anyone else
-- (docs/collaboration.md). This is the transfer half: the caller must be the
-- current owner and the target must already be a member, so ownership can
-- never be pushed onto a stranger.
create or replace function public.notes_transfer_ownership(
  p_folder uuid,
  p_user   uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select owner_id into v_owner
    from public.notes_folders
   where id = p_folder and deleted = false
   for update;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the owner may transfer this folder' using errcode = '42501';
  end if;

  if p_user = v_owner then
    raise exception 'that user already owns this folder' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.notes_folder_members
     where folder_id = p_folder and user_id = p_user
  ) then
    raise exception 'the new owner must already be a member' using errcode = '22023';
  end if;

  -- notes_sync_owner_membership() fires on this update: it DELETES the old
  -- owner's member row and upserts the new owner as 'owner'. So the new owner
  -- needs no statement here — but the old owner would be dropped from the
  -- folder entirely, which is not what "transfer" should mean. Re-add them as
  -- an editor so they keep the access they had.
  update public.notes_folders set owner_id = p_user where id = p_folder;

  insert into public.notes_folder_members (folder_id, user_id, role)
  values (p_folder, v_owner, 'editor')
  on conflict (folder_id, user_id) do update set role = 'editor';

  return 'transferred';
end;
$$;

-- PostgREST exposes every function at /rest/v1/rpc/<name> and EXECUTE defaults
-- to PUBLIC — same close-the-surface rule as 0004.
revoke execute on function
  public.notes_suggested_folders(),
  public.notes_transfer_ownership(uuid, uuid)
from public, anon;

grant execute on function
  public.notes_suggested_folders(),
  public.notes_transfer_ownership(uuid, uuid)
to authenticated;

commit;
