-- Web generation with the reader's own AI key, run as durable jobs.
--
-- 1. notes_ai_keys: one encrypted key per reader per service. The app server
--    encrypts it (AES-256-GCM, with a secret only the server holds, bound to
--    the owner and service) before it ever reaches this table, and decrypts it
--    only to make a call. A row is useless without that secret, and RLS keeps
--    each reader to their own rows anyway.
--
-- 2. notes_jobs: the outbox. Asking for a lesson, quiz, slide pictures or a
--    cheatsheet step writes one row here, in one transaction with its
--    permission check (notes_enqueue_job). The server works through a row one
--    AI call at a time, saving progress on the row after each, so a run
--    survives a reload, a closed tab or a function that times out: the next
--    worker claims it (notes_claim_job) once the previous lease has lapsed.
--
-- 3. notes-job-uploads: the slides a job reads, uploaded by the browser
--    straight to storage (no app request carries them), one folder per reader.
--
-- 4. Pins search_path on is_valid_username (the security advisor's warning on
--    Notecom's own function).

-- 1 --------------------------------------------------------------------------

create table public.notes_ai_keys (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  service text not null check (service in ('anthropic', 'openai', 'gemini', 'openrouter')),
  -- "v1:<iv>:<ciphertext>:<tag>", base64 parts; see lib/ai/vault.ts
  ciphertext text not null check (ciphertext like 'v1:%'),
  -- the last four characters, to show the reader which key is saved
  hint text not null check (char_length(hint) <= 8),
  model text check (model is null or char_length(model) <= 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, service)
);

alter table public.notes_ai_keys enable row level security;

create policy notes_ai_keys_select on public.notes_ai_keys
  for select to authenticated using (owner_id = auth.uid());
create policy notes_ai_keys_insert on public.notes_ai_keys
  for insert to authenticated with check (owner_id = auth.uid());
create policy notes_ai_keys_update on public.notes_ai_keys
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy notes_ai_keys_delete on public.notes_ai_keys
  for delete to authenticated using (owner_id = auth.uid());

revoke all on public.notes_ai_keys from anon;

-- 2 --------------------------------------------------------------------------

create table public.notes_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  folder_id uuid not null references public.notes_folders (id) on delete cascade,
  kind text not null check (kind in ('lesson', 'quiz', 'pictures', 'sheet-write', 'sheet-edit', 'sheet-review')),
  service text not null check (service in ('anthropic', 'openai', 'gemini', 'openrouter')),
  model text not null check (char_length(model) between 1 and 128),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'error', 'cancelled')),
  -- what was asked: the folder slug, upload paths, sheet spec, request text
  params jsonb not null default '{}'::jsonb,
  -- where the work stands between AI calls
  state jsonb not null default '{}'::jsonb,
  log text[] not null default '{}',
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  -- the saved document, once there is one: {"id": ..., "title": ...}
  result jsonb,
  lease_until timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_jobs_owner_status on public.notes_jobs (owner_id, status, created_at desc);

alter table public.notes_jobs enable row level security;

create policy notes_jobs_select on public.notes_jobs
  for select to authenticated using (owner_id = auth.uid());
-- A job can only be filed against a folder the reader may write: the same
-- predicate the documents table uses, so a job can never write where its
-- owner couldn't.
create policy notes_jobs_insert on public.notes_jobs
  for insert to authenticated
  with check (owner_id = auth.uid() and public.notes_can_write_folder(folder_id));
create policy notes_jobs_update on public.notes_jobs
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy notes_jobs_delete on public.notes_jobs
  for delete to authenticated using (owner_id = auth.uid());

revoke all on public.notes_jobs from anon;

-- Files a job, checking first that the reader has fewer than three going.
-- One statement each, in one transaction: two tabs can't both slip under the
-- limit. Invoker rights, so the insert policy above still applies.
create or replace function public.notes_enqueue_job(
  p_folder uuid,
  p_kind text,
  p_service text,
  p_model text,
  p_params jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('notes_jobs:' || auth.uid()::text));
  if (select count(*) from public.notes_jobs
      where owner_id = auth.uid() and status in ('queued', 'running')) >= 3 then
    raise exception 'too many jobs' using errcode = 'P0001';
  end if;
  insert into public.notes_jobs (folder_id, kind, service, model, params)
  values (p_folder, p_kind, p_service, p_model, coalesce(p_params, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

-- Takes a job for one worker: a queued one, or a running one whose worker's
-- lease has lapsed (it timed out or died). Atomic, so two workers can never
-- hold the same job. Gives up on a job after five attempts.
create or replace function public.notes_claim_job(p_id uuid, p_lease_seconds integer)
returns setof public.notes_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.notes_jobs
     set status = 'error',
         log = log || 'Stopped after five tries — each one ran out of time. Try a faster model.'::text,
         lease_until = null,
         updated_at = now()
   where id = p_id and owner_id = auth.uid()
     and status = 'running' and lease_until < now() and attempts >= 5;

  return query
  update public.notes_jobs
     set status = 'running',
         lease_until = now() + make_interval(secs => least(greatest(p_lease_seconds, 30), 900)),
         attempts = attempts + 1,
         updated_at = now()
   where id = p_id and owner_id = auth.uid()
     and (status = 'queued' or (status = 'running' and lease_until < now() and attempts < 5))
  returning *;
end;
$$;

revoke execute on function public.notes_enqueue_job(uuid, text, text, text, jsonb) from public, anon;
revoke execute on function public.notes_claim_job(uuid, integer) from public, anon;
grant execute on function public.notes_enqueue_job(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.notes_claim_job(uuid, integer) to authenticated;

-- 3 --------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('notes-job-uploads', 'notes-job-uploads', false, 20971520)
on conflict (id) do nothing;

create policy notes_job_uploads_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'notes-job-uploads' and split_part(name, '/', 1) = auth.uid()::text);
create policy notes_job_uploads_select on storage.objects
  for select to authenticated
  using (bucket_id = 'notes-job-uploads' and split_part(name, '/', 1) = auth.uid()::text);
create policy notes_job_uploads_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'notes-job-uploads' and split_part(name, '/', 1) = auth.uid()::text);

-- 4 --------------------------------------------------------------------------

alter function public.is_valid_username(text) set search_path = public, pg_temp;
