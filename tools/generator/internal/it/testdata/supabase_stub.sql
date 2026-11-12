-- Just enough of the Supabase project for the generator's integration test:
-- its roles and default privileges, auth.uid(), and the notes_* tables and
-- functions migration 0036 builds on, as they stand after 0035. Taken from
-- the live schema; storage is left out (uploads are served by the test).

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

-- Like the project: new functions are executable by the API roles (and, by
-- Postgres's own default, by PUBLIC — every migration revokes that itself);
-- new tables are granted to the API roles (RLS decides).
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create table public.notes_folders (
  id uuid primary key,
  slug text not null,
  name text not null,
  owner_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  deleted boolean not null default false,
  visibility text not null default 'private'
);

create table public.notes_folder_roles (
  role text primary key,
  rank integer not null,
  can_write boolean not null default false,
  can_manage boolean not null default false
);
insert into public.notes_folder_roles values ('owner', 30, true, true), ('editor', 20, true, false), ('viewer', 10, false, false);

create table public.notes_folder_members (
  folder_id uuid not null references public.notes_folders (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  role text not null references public.notes_folder_roles (role),
  joined_at timestamptz not null default now(),
  primary key (folder_id, user_id)
);

create function public.notes_folder_role(p_folder uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select m.role from public.notes_folder_members m
   where m.folder_id = p_folder and m.user_id = auth.uid();
$$;

create function public.notes_can_write_folder(p_folder uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select r.can_write from public.notes_folder_roles r where r.role = public.notes_folder_role(p_folder)),
    false
  );
$$;

create table public.notes_documents (
  id uuid primary key,
  folder_id uuid not null references public.notes_folders (id) on delete cascade,
  kind text not null constraint notes_documents_kind_format check (kind ~ '^[a-z][a-z-]{0,31}$'),
  doc_key text not null,
  slug text not null,
  title text not null,
  seq integer not null,
  html text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  version integer not null default 1,
  deleted boolean not null default false,
  synced_at timestamptz not null default now(),
  title_pinned boolean not null default false,
  meta jsonb
);
create unique index notes_documents_doc_key_key on public.notes_documents (folder_id, kind, doc_key);
alter table public.notes_documents enable row level security;
create policy notes_documents_select on public.notes_documents for select to authenticated
  using (public.notes_folder_role(folder_id) is not null);

create function public.notes_touch_synced_at() returns trigger language plpgsql set search_path = '' as $$
begin
  new.synced_at = now();
  return new;
end;
$$;
create trigger notes_documents_touch before insert or update on public.notes_documents
  for each row execute function public.notes_touch_synced_at();

create table public.notes_doc_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.notes_documents (id) on delete cascade,
  folder_id uuid not null references public.notes_folders (id) on delete cascade,
  idx integer not null,
  doc_version integer not null default 0,
  topic text not null default '',
  heading text not null default '',
  heading_index integer not null default 0,
  summary text not null default '',
  keywords text not null default '',
  body text not null default '',
  html text not null default '',
  search_tsv tsvector generated always as (to_tsvector('simple', heading || ' ' || keywords || ' ' || body)) stored,
  unique (document_id, idx)
);
alter table public.notes_doc_chunks enable row level security;

-- 0034 / 0035 -------------------------------------------------------------

create table public.notes_ai_keys (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  service text not null check (service in ('anthropic', 'openai', 'gemini', 'openrouter')),
  ciphertext text not null check (ciphertext like 'v1:%'),
  hint text not null check (char_length(hint) <= 8),
  model text check (model is null or char_length(model) <= 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, service)
);
alter table public.notes_ai_keys enable row level security;
create policy notes_ai_keys_select on public.notes_ai_keys for select to authenticated using (owner_id = auth.uid());
revoke all on public.notes_ai_keys from anon;

create table public.notes_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  folder_id uuid not null references public.notes_folders (id) on delete cascade,
  kind text not null check (kind in ('lesson', 'quiz', 'pictures', 'sheet-write', 'sheet-edit', 'sheet-review')),
  service text not null check (service in ('anthropic', 'openai', 'gemini', 'openrouter')),
  model text not null check (char_length(model) between 1 and 128),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'error', 'cancelled')),
  params jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  log text[] not null default '{}',
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  result jsonb,
  lease_until timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  worker uuid
);
alter table public.notes_jobs enable row level security;
create policy notes_jobs_select on public.notes_jobs for select to authenticated using (owner_id = auth.uid());
create policy notes_jobs_delete on public.notes_jobs for delete to authenticated using (owner_id = auth.uid());
revoke all on public.notes_jobs from anon;
revoke insert, update on public.notes_jobs from authenticated;

create function public.notes_enqueue_job(p_folder uuid, p_kind text, p_service text, p_model text, p_params jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  insert into public.notes_jobs (owner_id, folder_id, kind, service, model, params)
  values (auth.uid(), p_folder, p_kind, p_service, p_model, p_params) returning id into v_id;
  return v_id;
end;
$$;

create function public.notes_cancel_job(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uploads jsonb;
begin
  if auth.uid() is null then return null; end if;
  update public.notes_jobs
     set status = 'cancelled', log = log || 'Stopped.'::text, lease_until = null, worker = null, updated_at = now()
   where id = p_id and owner_id = auth.uid() and status in ('queued', 'running')
  returning coalesce(params -> 'uploads', '[]'::jsonb) into v_uploads;
  return v_uploads;
end;
$$;
revoke execute on function public.notes_cancel_job(uuid) from public, anon;
