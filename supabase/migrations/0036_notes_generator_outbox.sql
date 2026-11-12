-- Lessons and quizzes written by the Go generator on the VPS (tools/generator).
--
-- Until now a web job was worked by the app's own requests, a few minutes at
-- a time, with the reader's page asking it to continue. A job filed for the
-- VPS is worked there instead, start to finish, page open or not.
--
-- 1. notes_jobs.runner: 'web' (the app's requests, as before) or 'vps' (the
--    generator). Only lessons and quizzes go to the VPS for now. Each side
--    claims only its own jobs, so a job is never worked by both.
--
-- 2. notes_job_outbox: the transactional outbox. notes_enqueue_job writes the
--    job and its "filed" message in one transaction, and NOTIFYs on commit. A
--    relay in the generator publishes each message to NATS JetStream and marks
--    it published; the worker consumes from JetStream. A job is never filed
--    without its message, and a message is never sent for a job that rolled
--    back. Delivery is at least once: the worker's claim is the dedupe.
--
-- 3. notes_generator: the generator's own database role. It is not the
--    service role and bypasses no RLS. It owns nothing and may read or write
--    no table; it may only call the notes_gen_* functions below, each of which
--    checks that the caller holds a running VPS job (its worker token and
--    lease) and acts only on that job: its row, its owner's key for its
--    service, and its folder, where a save first re-checks — as the owner,
--    with the same notes_can_write_folder RLS uses — that the owner may still
--    write. The permission check that matters was made when the job was filed,
--    under RLS, in the same transaction as the outbox message.
--
--    Created NOLOGIN. Give it a password by hand, outside git:
--      alter role notes_generator with login password '<generated>';
--    and connect through the Supavisor session pooler as
--    notes_generator.<project-ref>.
--
-- Note: functions created here get EXECUTE for anon/authenticated/service_role
-- by this project's default privileges, so every notes_gen_* function revokes
-- them explicitly. Readers must never reach these through PostgREST.

-- 1 --------------------------------------------------------------------------

alter table public.notes_jobs
  add column runner text not null default 'web' check (runner in ('web', 'vps'));
alter table public.notes_jobs
  add constraint notes_jobs_vps_kinds check (runner = 'web' or kind in ('lesson', 'quiz'));

create index notes_jobs_vps_open on public.notes_jobs (status, updated_at)
  where runner = 'vps' and status in ('queued', 'running');

-- 2 --------------------------------------------------------------------------

create table public.notes_job_outbox (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.notes_jobs (id) on delete cascade,
  event text not null check (event in ('filed')),
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create index notes_job_outbox_unpublished on public.notes_job_outbox (id) where published_at is null;
create index notes_job_outbox_job on public.notes_job_outbox (job_id, created_at desc);

-- Nobody reads or writes it directly; the functions below are the only way.
alter table public.notes_job_outbox enable row level security;
revoke all on public.notes_job_outbox from anon, authenticated;
revoke all on sequence public.notes_job_outbox_id_seq from anon, authenticated;

-- Files a job. Same checks as 0035, plus the runner; a VPS job's outbox
-- message is written in the same transaction and announced on commit.
drop function if exists public.notes_enqueue_job(uuid, text, text, text, jsonb);

create function public.notes_enqueue_job(
  p_folder uuid,
  p_kind text,
  p_service text,
  p_model text,
  p_params jsonb,
  p_runner text default 'web'
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  -- Absent and unwritable look the same.
  if p_folder is null or not public.notes_can_write_folder(p_folder) then
    raise exception 'folder not found' using errcode = 'P0002';
  end if;
  if p_params is null or jsonb_typeof(p_params) <> 'object' or pg_column_size(p_params) > 512 * 1024 then
    raise exception 'invalid job' using errcode = '22023';
  end if;
  if p_runner is null or p_runner not in ('web', 'vps') or (p_runner = 'vps' and p_kind not in ('lesson', 'quiz')) then
    raise exception 'invalid job' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('notes_jobs:' || v_uid::text));
  if (select count(*) from public.notes_jobs
      where owner_id = v_uid and status in ('queued', 'running')) >= 3 then
    raise exception 'too many jobs' using errcode = 'P0001';
  end if;
  if (select count(*) from public.notes_jobs
      where owner_id = v_uid and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too many jobs this hour' using errcode = 'P0001';
  end if;
  insert into public.notes_jobs (owner_id, folder_id, kind, service, model, params, runner, log)
  values (
    v_uid, p_folder, p_kind, p_service, p_model, p_params, p_runner,
    case when p_runner = 'vps' then array['Queued on the generator.'] else '{}'::text[] end
  )
  returning id into v_id;
  if p_runner = 'vps' then
    insert into public.notes_job_outbox (job_id, event) values (v_id, 'filed');
    perform pg_notify('notes_job_outbox', '');
  end if;
  return v_id;
end;
$$;

-- The app's own worker (lib/jobs/run.ts) claims web jobs only. Otherwise
-- unchanged from 0035.
create or replace function public.notes_claim_job(p_id uuid, p_lease_seconds integer)
returns setof public.notes_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  update public.notes_jobs
     set status = 'error',
         log = log || 'Stopped after five tries — each one ran out of time. Try a faster model.'::text,
         lease_until = null,
         worker = null,
         updated_at = now()
   where id = p_id and owner_id = v_uid and runner = 'web'
     and status = 'running' and lease_until < now() and attempts >= 5;

  update public.notes_jobs
     set status = 'error',
         log = log || 'Stopped: a run may take at most six hours.'::text,
         lease_until = null,
         worker = null,
         updated_at = now()
   where id = p_id and owner_id = v_uid and runner = 'web'
     and status in ('queued', 'running') and (lease_until is null or lease_until < now())
     and created_at < now() - interval '6 hours';

  return query
  update public.notes_jobs
     set status = 'running',
         lease_until = now() + make_interval(secs => least(greatest(p_lease_seconds, 30), 900)),
         attempts = attempts + 1,
         worker = gen_random_uuid(),
         updated_at = now()
   where id = p_id and owner_id = v_uid and runner = 'web'
     and (status = 'queued' or (status = 'running' and lease_until < now() and attempts < 5))
  returning *;
end;
$$;

-- A web worker's save. Web jobs only: a reader can read their own job's
-- worker token, and must not be able to write a VPS job's progress with it.
create or replace function public.notes_job_progress(
  p_id uuid,
  p_worker uuid,
  p_status text,
  p_log text[],
  p_state jsonb,
  p_result jsonb,
  p_tokens_in integer,
  p_tokens_out integer,
  p_lease_seconds integer,
  p_step_done boolean
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_worker is null
     or p_status not in ('running', 'queued', 'done', 'error')
     or coalesce(array_length(p_log, 1), 0) > 2000
     or pg_column_size(p_state) > 4 * 1024 * 1024
     or pg_column_size(p_result) > 4096 then
    return false;
  end if;
  update public.notes_jobs
     set status = p_status,
         log = coalesce(p_log, '{}'),
         state = coalesce(p_state, '{}'::jsonb),
         result = p_result,
         tokens_in = greatest(coalesce(p_tokens_in, 0), 0),
         tokens_out = greatest(coalesce(p_tokens_out, 0), 0),
         lease_until = case when p_status = 'running'
                            then now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 90), 30), 900))
                       end,
         worker = case when p_status = 'running' then worker end,
         attempts = case when p_step_done then 0 else attempts end,
         updated_at = now()
   where id = p_id and owner_id = v_uid and runner = 'web' and status = 'running' and worker = p_worker;
  return found;
end;
$$;

revoke execute on function public.notes_enqueue_job(uuid, text, text, text, jsonb, text) from public, anon;
grant execute on function public.notes_enqueue_job(uuid, text, text, text, jsonb, text) to authenticated;

-- 3 --------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'notes_generator') then
    -- Pool + listener need five; the rest is room for a restart's old sessions.
    create role notes_generator nologin noinherit connection limit 10;
  end if;
end;
$$;

alter role notes_generator set statement_timeout = '30s';
alter role notes_generator set idle_in_transaction_session_timeout = '60s';
grant usage on schema public to notes_generator;

-- The job a worker holds, or an error. Not callable on its own: the
-- functions below call it as their owner.
create function public.notes_gen_held(p_id uuid, p_worker uuid)
returns public.notes_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.notes_jobs;
begin
  select * into v from public.notes_jobs
   where id = p_id and worker = p_worker and runner = 'vps'
     and status = 'running' and lease_until > now();
  if not found then
    raise exception 'job not held' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- Whether the job's owner may still write its folder, decided by the same
-- function RLS uses, evaluated as the owner. Both claim settings are set
-- (auth.uid() reads request.jwt.claim.sub first) and both are cleared again
-- before returning, so nothing after this runs as anyone in particular.
create function public.notes_gen_owner_can_write(p_job public.notes_jobs)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ok boolean;
begin
  perform set_config('request.jwt.claim.sub', p_job.owner_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_job.owner_id, 'role', 'authenticated')::text, true);
  v_ok := coalesce(public.notes_can_write_folder(p_job.folder_id), false);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return v_ok;
end;
$$;

-- Takes a VPS job: a queued one, or a running one whose lease lapsed (its
-- worker died). Atomic, so two workers never hold one; hands back a fresh
-- worker token. The same limits as the web claim: five lapsed leases on one
-- step, or six hours since filing, and the job is given up on.
create function public.notes_gen_claim(p_id uuid, p_lease_seconds integer)
returns setof public.notes_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.notes_jobs
     set status = 'error',
         log = log || 'Stopped after five tries — the generator kept losing this run. Try again later.'::text,
         lease_until = null,
         worker = null,
         updated_at = now()
   where id = p_id and runner = 'vps'
     and status = 'running' and lease_until < now() and attempts >= 5;

  update public.notes_jobs
     set status = 'error',
         log = log || 'Stopped: a run may take at most six hours.'::text,
         lease_until = null,
         worker = null,
         updated_at = now()
   where id = p_id and runner = 'vps'
     and status in ('queued', 'running') and (lease_until is null or lease_until < now())
     and created_at < now() - interval '6 hours';

  return query
  update public.notes_jobs
     set status = 'running',
         lease_until = now() + make_interval(secs => least(greatest(p_lease_seconds, 30), 900)),
         attempts = attempts + 1,
         worker = gen_random_uuid(),
         updated_at = now()
   where id = p_id and runner = 'vps'
     and (status = 'queued' or (status = 'running' and lease_until < now() and attempts < 5))
  returning *;
end;
$$;

-- A worker's progress save; false when the job is no longer this worker's
-- (the reader stopped it, or the lease lapsed and another worker took it).
-- 'queued' hands the job back (the generator is shutting down).
create function public.notes_gen_progress(
  p_id uuid,
  p_worker uuid,
  p_status text,
  p_log text[],
  p_state jsonb,
  p_result jsonb,
  p_tokens_in integer,
  p_tokens_out integer,
  p_lease_seconds integer,
  p_step_done boolean
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_worker is null
     or p_status not in ('running', 'queued', 'done', 'error')
     or coalesce(array_length(p_log, 1), 0) > 2000
     or pg_column_size(p_state) > 4 * 1024 * 1024
     or pg_column_size(p_result) > 4096 then
    return false;
  end if;
  update public.notes_jobs
     set status = p_status,
         log = coalesce(p_log, '{}'),
         state = coalesce(p_state, '{}'::jsonb),
         result = p_result,
         tokens_in = greatest(coalesce(p_tokens_in, 0), 0),
         tokens_out = greatest(coalesce(p_tokens_out, 0), 0),
         lease_until = case when p_status = 'running'
                            then now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 90), 30), 900))
                       end,
         worker = case when p_status = 'running' then worker end,
         attempts = case when p_step_done then 0 else attempts end,
         updated_at = now()
   where id = p_id and runner = 'vps' and status = 'running' and worker = p_worker;
  if found and p_status = 'queued' then
    -- Handed back: announce it, so a worker picks it up again.
    insert into public.notes_job_outbox (job_id, event) values (p_id, 'filed');
    perform pg_notify('notes_job_outbox', '');
  end if;
  return found;
end;
$$;

-- The encrypted key the job's owner saved for the job's service. The
-- generator decrypts it with AI_KEYS_SECRET for the job's own calls.
create function public.notes_gen_key(p_id uuid, p_worker uuid)
returns table (owner_id uuid, service text, ciphertext text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v public.notes_jobs := public.notes_gen_held(p_id, p_worker);
begin
  return query
  select k.owner_id, k.service, k.ciphertext
    from public.notes_ai_keys k
   where k.owner_id = v.owner_id and k.service = v.service;
end;
$$;

-- The job folder's documents of one kind, numbered without gaps first (as
-- lib/generate/save.ts does before numbering a new one). Every key, live or
-- deleted, so a new name never collides with a tombstone either.
create function public.notes_gen_docs(p_id uuid, p_worker uuid, p_kind text)
returns table (doc_key text, title text, seq integer, deleted boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v public.notes_jobs := public.notes_gen_held(p_id, p_worker);
begin
  if p_kind not in ('lesson', 'quiz') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if not public.notes_gen_owner_can_write(v) then
    raise exception 'folder not writable' using errcode = '42501';
  end if;
  with ordered as (
    select d.id, row_number() over (order by d.seq, d.created_at) as n
      from public.notes_documents d
     where d.folder_id = v.folder_id and d.kind = p_kind and d.deleted = false
  )
  update public.notes_documents d
     set seq = o.n
    from ordered o
   where d.id = o.id and d.seq <> o.n;
  return query
  select d.doc_key, d.title, d.seq, d.deleted
    from public.notes_documents d
   where d.folder_id = v.folder_id and d.kind = p_kind
   order by d.deleted, d.seq;
end;
$$;

-- Saves a generated lesson or quiz into the job's folder: a new document
-- under a key the generator chose, its search chunks, and the job's result —
-- one transaction, so a worker that dies after the save finds the result on
-- the job instead of saving twice. Null when the key is already taken (the
-- generator picks the next one). Naming stays in the generator; the database
-- invents none of it.
create function public.notes_gen_save_doc(
  p_id uuid,
  p_worker uuid,
  p_kind text,
  p_doc_key text,
  p_slug text,
  p_title text,
  p_seq integer,
  p_html text,
  p_chunks jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.notes_jobs := public.notes_gen_held(p_id, p_worker);
  v_doc uuid;
  v_result jsonb;
begin
  if p_kind is distinct from (case v.kind when 'quiz' then 'quiz' else 'lesson' end)
     or p_doc_key !~ '^[0-9]{2,}-[a-z0-9][a-z0-9-]{0,190}$'
     or p_slug !~ '^[a-z0-9][a-z0-9-]{0,180}$'
     or coalesce(char_length(p_title), 0) not between 1 and 300
     or p_seq is null or p_seq < 1
     or p_html is null or octet_length(p_html) > 4 * 1024 * 1024
     or jsonb_typeof(p_chunks) is distinct from 'array' then
    raise exception 'invalid document' using errcode = '22023';
  end if;
  if not public.notes_gen_owner_can_write(v) then
    raise exception 'folder not writable' using errcode = '42501';
  end if;

  insert into public.notes_documents
    (id, folder_id, kind, doc_key, slug, title, seq, html, meta, created_at, updated_at, version, deleted)
  values
    (gen_random_uuid(), v.folder_id, p_kind, p_doc_key, p_slug, p_title, p_seq, p_html, null, now(), now(), 1, false)
  on conflict (folder_id, kind, doc_key) do nothing
  returning id into v_doc;
  if v_doc is null then
    return null;
  end if;

  insert into public.notes_doc_chunks
    (document_id, folder_id, idx, doc_version, topic, heading, heading_index, summary, keywords, body, html)
  select v_doc, v.folder_id, c.idx, 1, c.topic, c.heading, c.heading_index, c.summary, c.keywords, c.body, c.html
    from jsonb_to_recordset(p_chunks) as c(
      idx integer, topic text, heading text, heading_index integer,
      summary text, keywords text, body text, html text
    );

  v_result := jsonb_build_object('id', p_doc_key, 'title', p_title);
  update public.notes_jobs set result = v_result, updated_at = now() where id = v.id;
  return v_result;
end;
$$;

-- The relay's side of the outbox. Called inside one transaction by the
-- relay: take locks the messages it returns until the relay commits, so two
-- relays never publish the same batch; done marks them published.
create function public.notes_gen_outbox_take(p_limit integer)
returns table (id bigint, job_id uuid, kind text, event text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select o.id, o.job_id, j.kind, o.event
    from public.notes_job_outbox o
    join public.notes_jobs j on j.id = o.job_id
   where o.published_at is null
   order by o.id
   limit least(greatest(coalesce(p_limit, 50), 1), 500)
     for update of o skip locked;
$$;

create function public.notes_gen_outbox_done(p_ids bigint[])
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.notes_job_outbox set published_at = now()
   where id = any (p_ids) and published_at is null;
$$;

-- Repairs lost messages: a VPS job still going whose last message is ten
-- minutes old (the broker lost it, or every delivery was dropped) is filed
-- again. A duplicate costs one refused claim. Also prunes old messages.
create function public.notes_gen_outbox_sweep()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  insert into public.notes_job_outbox (job_id, event)
  select j.id, 'filed'
    from public.notes_jobs j
   where j.runner = 'vps'
     and (j.status = 'queued' or (j.status = 'running' and j.lease_until < now() - interval '30 seconds'))
     and not exists (
       select 1 from public.notes_job_outbox o
        where o.job_id = j.id and o.created_at > now() - interval '10 minutes'
     );
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform pg_notify('notes_job_outbox', '');
  end if;
  delete from public.notes_job_outbox where published_at < now() - interval '7 days';
  return v_n;
end;
$$;

-- Only the generator calls these; nobody calls the two helpers directly.
revoke execute on function public.notes_gen_held(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.notes_gen_owner_can_write(public.notes_jobs) from public, anon, authenticated, service_role;
revoke execute on function public.notes_gen_claim(uuid, integer) from public, anon, authenticated, service_role;
revoke execute on function public.notes_gen_progress(uuid, uuid, text, text[], jsonb, jsonb, integer, integer, integer, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.notes_gen_key(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.notes_gen_docs(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.notes_gen_save_doc(uuid, uuid, text, text, text, text, integer, text, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.notes_gen_outbox_take(integer) from public, anon, authenticated, service_role;
revoke execute on function public.notes_gen_outbox_done(bigint[]) from public, anon, authenticated, service_role;
revoke execute on function public.notes_gen_outbox_sweep() from public, anon, authenticated, service_role;

grant execute on function public.notes_gen_claim(uuid, integer) to notes_generator;
grant execute on function public.notes_gen_progress(uuid, uuid, text, text[], jsonb, jsonb, integer, integer, integer, boolean) to notes_generator;
grant execute on function public.notes_gen_key(uuid, uuid) to notes_generator;
grant execute on function public.notes_gen_docs(uuid, uuid, text) to notes_generator;
grant execute on function public.notes_gen_save_doc(uuid, uuid, text, text, text, text, integer, text, jsonb) to notes_generator;
grant execute on function public.notes_gen_outbox_take(integer) to notes_generator;
grant execute on function public.notes_gen_outbox_done(bigint[]) to notes_generator;
grant execute on function public.notes_gen_outbox_sweep() to notes_generator;
