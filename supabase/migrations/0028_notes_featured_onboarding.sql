-- Featured folders, and the onboarding that puts a new account into them.
--
-- A new account owns nothing and belongs to nothing, so its first screen was
-- empty. 0025 answered that with a self-serve tag; 0026 retired tags as access,
-- so the answer is now membership, the one access path left.
--
-- `notes_folders.featured` is the owner's standing offer: "anyone new may start
-- here". `notes_onboard()` acts on it once per account — a viewer membership in
-- every featured folder, and an accepted follow of each featured owner. The
-- follow skips the usual request because marking a folder featured *is* that
-- owner's consent to being followed by newcomers; every other follow still
-- waits for an answer.
--
-- Once per account, not once per visit: `notes_profiles_onboarded` records that
-- it ran, so someone who leaves a featured folder is not put back in it on
-- their next page load. The column is not client-writable (authenticated holds
-- UPDATE only on named columns of notes_folders), so featuring is a
-- migration-level decision for now.

begin;

alter table public.notes_folders
  add column if not exists featured boolean not null default false;

create table if not exists public.notes_profiles_onboarded (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  onboarded_at timestamptz not null default now()
);

alter table public.notes_profiles_onboarded enable row level security;
revoke all on table public.notes_profiles_onboarded from anon;

-- Readable by its owner only; written only by notes_onboard().
drop policy if exists notes_profiles_onboarded_select on public.notes_profiles_onboarded;
create policy notes_profiles_onboarded_select on public.notes_profiles_onboarded
  for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.notes_onboard()
returns integer
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_joined integer := 0;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  insert into public.notes_profiles_onboarded (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;
  if not found then
    return 0;
  end if;

  insert into public.notes_folder_members (folder_id, user_id, role)
  select f.id, v_uid, 'viewer'
    from public.notes_folders f
   where f.featured and f.deleted = false and f.owner_id <> v_uid
  on conflict (folder_id, user_id) do nothing;
  get diagnostics v_joined = row_count;

  insert into public.notes_follows (follower_id, followee_id, status)
  select distinct v_uid, f.owner_id, 'accepted'
    from public.notes_folders f
   where f.featured and f.deleted = false and f.owner_id <> v_uid
  on conflict (follower_id, followee_id) do update set status = 'accepted';

  return v_joined;
end;
$$;

revoke execute on function public.notes_onboard() from public, anon;
grant execute on function public.notes_onboard() to authenticated;

-- Seed: the three demo courses become public and featured, and the retired
-- demo tag comes off them. Lookup by owner username and slug; skipped on a
-- database without that account.
do $$
declare
  v_owner uuid;
begin
  select id into v_owner from public.profiles where lower(username) = 'wyco';
  if v_owner is null then
    raise notice 'no profile named wyco here — skipping the featured seed';
    return;
  end if;

  update public.notes_folders
     set featured = true, visibility = 'public'
   where owner_id = v_owner
     and deleted = false
     and slug in ('General-Education', 'Wireless-Network', 'Operating-System');

  delete from public.notes_folder_tags
   where tag_id = (select id from public.notes_tags where slug = 'demo');
  update public.notes_tags set self_serve = false where slug = 'demo';
end $$;

commit;
