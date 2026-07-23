-- Collaborative folders: schema.
--
-- Folders become the unit of sharing (owner, members, roles, visibility,
-- discoverability, tags). Documents deliberately gain nothing — they inherit
-- their folder's permissions, and a per-document permission column would be a
-- second, contradictory source of truth. See docs/collaboration.md.
--
-- Existing rows (7 folders, 27 documents) are backfilled to the operator's
-- profile as private and non-discoverable: a migration must not publish
-- anything that was previously unshared.

begin;

-- --- notes_folders: extend rather than replace -------------------------------

alter table public.notes_folders
  add column if not exists owner_id     uuid,
  add column if not exists description  text,
  add column if not exists visibility   text    not null default 'private',
  add column if not exists discoverable boolean not null default true,
  add column if not exists join_policy  text    not null default 'request';

update public.notes_folders
   set owner_id     = 'bd8c9c25-ae8c-4df0-bebf-1632be6fe628',
       discoverable = false
 where owner_id is null;

alter table public.notes_folders
  alter column owner_id set not null;

alter table public.notes_folders
  add constraint notes_folders_owner_id_fkey
    foreign key (owner_id) references public.profiles(id) on delete cascade,
  add constraint notes_folders_visibility_check
    check (visibility in ('public', 'private')),
  add constraint notes_folders_join_policy_check
    check (join_policy in ('open', 'request', 'invite_only')),
  add constraint notes_folders_description_check
    check (description is null or char_length(description) <= 2000);

-- Slugs are folder-local to an owner, not global: two users may both keep a
-- folder called "networking". Callers that resolve a folder from a slug must
-- therefore scope by owner (or use the id).
create unique index if not exists notes_folders_owner_slug_key
  on public.notes_folders (owner_id, slug)
  where deleted = false;

create index if not exists notes_folders_owner_idx
  on public.notes_folders (owner_id);

-- 'simple' rather than a language config: this app has no translation feature
-- and lesson titles are mixed-language technical terms, so stemming would hurt.
alter table public.notes_folders
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, ''))
  ) stored;

create index if not exists notes_folders_search_idx
  on public.notes_folders using gin (search_tsv);

-- The sync tables were created by a client without a declared foreign key, so
-- PostgREST could not embed documents under folders and nothing enforced
-- referential integrity. Both matter now that policies join across them.
delete from public.notes_documents d
 where not exists (select 1 from public.notes_folders f where f.id = d.folder_id);

alter table public.notes_documents
  add constraint notes_documents_folder_id_fkey
    foreign key (folder_id) references public.notes_folders(id) on delete cascade;

create index if not exists notes_documents_folder_idx
  on public.notes_documents (folder_id);

-- --- roles as data, not as a constraint --------------------------------------

create table if not exists public.notes_folder_roles (
  role       text    primary key,
  rank       integer not null unique,
  can_write  boolean not null default false,
  can_manage boolean not null default false
);

insert into public.notes_folder_roles (role, rank, can_write, can_manage) values
  ('owner',  30, true,  true),
  ('editor', 20, true,  false),
  ('viewer', 10, false, false)
on conflict (role) do nothing;

-- --- membership ---------------------------------------------------------------

create table if not exists public.notes_folder_members (
  folder_id uuid        not null references public.notes_folders(id) on delete cascade,
  user_id   uuid        not null references public.profiles(id)      on delete cascade,
  role      text        not null references public.notes_folder_roles(role),
  joined_at timestamptz not null default now(),
  primary key (folder_id, user_id)
);

create index if not exists notes_folder_members_user_idx
  on public.notes_folder_members (user_id);

-- Exactly one owner row per folder, always in step with notes_folders.owner_id.
create or replace function public.notes_sync_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    delete from public.notes_folder_members
     where folder_id = new.id and user_id = old.owner_id;
  end if;

  insert into public.notes_folder_members (folder_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (folder_id, user_id) do update set role = 'owner';

  return new;
end;
$$;

drop trigger if exists notes_folders_owner_membership on public.notes_folders;
create trigger notes_folders_owner_membership
  after insert or update of owner_id on public.notes_folders
  for each row execute function public.notes_sync_owner_membership();

insert into public.notes_folder_members (folder_id, user_id, role)
select id, owner_id, 'owner' from public.notes_folders
on conflict (folder_id, user_id) do nothing;

-- --- tags ---------------------------------------------------------------------

-- Free-form and user-created, deliberately not the hardcoded `categories`
-- table BookCommunity uses.
create table if not exists public.notes_tags (
  id         bigint generated always as identity primary key,
  slug       text        not null unique,
  label      text        not null,
  created_by uuid        references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint notes_tags_slug_check  check (slug ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$'),
  constraint notes_tags_label_check check (char_length(label) between 1 and 40)
);

-- grants_join carries the optional access grant: "anyone who reached us through
-- this tag may join without approval". Per tag, not per folder, so a folder can
-- be discoverable under several tags while only one of them opens the door.
create table if not exists public.notes_folder_tags (
  folder_id   uuid    not null references public.notes_folders(id) on delete cascade,
  tag_id      bigint  not null references public.notes_tags(id)    on delete cascade,
  grants_join boolean not null default false,
  primary key (folder_id, tag_id)
);

create index if not exists notes_folder_tags_tag_idx
  on public.notes_folder_tags (tag_id);

-- --- invitations (owner -> user) ----------------------------------------------

create table if not exists public.notes_folder_invitations (
  id           uuid        primary key default gen_random_uuid(),
  folder_id    uuid        not null references public.notes_folders(id) on delete cascade,
  invitee_id   uuid        not null references public.profiles(id)      on delete cascade,
  inviter_id   uuid        not null references public.profiles(id)      on delete cascade,
  role         text        not null default 'viewer' references public.notes_folder_roles(role),
  status       text        not null default 'pending',
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint notes_folder_invitations_status_check
    check (status in ('pending', 'accepted', 'declined', 'revoked')),
  constraint notes_folder_invitations_not_owner_check
    check (invitee_id <> inviter_id)
);

-- One live invitation per (folder, invitee); answered ones stay as history.
create unique index if not exists notes_folder_invitations_pending_key
  on public.notes_folder_invitations (folder_id, invitee_id)
  where status = 'pending';

create index if not exists notes_folder_invitations_invitee_idx
  on public.notes_folder_invitations (invitee_id) where status = 'pending';

create index if not exists notes_folder_invitations_inviter_idx
  on public.notes_folder_invitations (inviter_id);

create index if not exists notes_folder_invitations_role_idx
  on public.notes_folder_invitations (role);

-- --- join requests (user -> owner) --------------------------------------------

create table if not exists public.notes_folder_join_requests (
  id         uuid        primary key default gen_random_uuid(),
  folder_id  uuid        not null references public.notes_folders(id) on delete cascade,
  user_id    uuid        not null references public.profiles(id)      on delete cascade,
  status     text        not null default 'pending',
  message    text,
  created_at timestamptz not null default now(),
  decided_by uuid        references public.profiles(id) on delete set null,
  decided_at timestamptz,
  constraint notes_folder_join_requests_status_check
    check (status in ('pending', 'approved', 'rejected')),
  constraint notes_folder_join_requests_message_check
    check (message is null or char_length(message) <= 500)
);

create unique index if not exists notes_folder_join_requests_pending_key
  on public.notes_folder_join_requests (folder_id, user_id)
  where status = 'pending';

create index if not exists notes_folder_join_requests_folder_idx
  on public.notes_folder_join_requests (folder_id) where status = 'pending';

create index if not exists notes_folder_join_requests_user_idx
  on public.notes_folder_join_requests (user_id);

create index if not exists notes_folder_join_requests_decided_by_idx
  on public.notes_folder_join_requests (decided_by);

create index if not exists notes_tags_created_by_idx
  on public.notes_tags (created_by);

alter table public.notes_folder_roles        enable row level security;
alter table public.notes_folder_members      enable row level security;
alter table public.notes_tags                enable row level security;
alter table public.notes_folder_tags         enable row level security;
alter table public.notes_folder_invitations  enable row level security;
alter table public.notes_folder_join_requests enable row level security;

commit;
