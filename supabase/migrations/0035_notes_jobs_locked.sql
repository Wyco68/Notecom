-- Web-generation jobs, locked down (security review of 0034).
--
-- 0034 let a reader insert and update their own job rows directly. The
-- worker acts as the reader, so it needed to — but so could the reader,
-- through PostgREST: file jobs past the three-at-a-time limit, revive a
-- finished job, or reset its counters, each one keeping a server function
-- busy for minutes. Now no row is written directly. Four functions do it,
-- each checking the caller and the row's state itself:
--
--   notes_enqueue_job    files a job: writable folder, fewer than 3 going,
--                        fewer than 30 filed in the last hour
--   notes_claim_job      takes a queued job, or a running one whose lease
--                        lapsed, and hands back a fresh worker token
--   notes_job_progress   saves a step; only the worker holding the token,
--                        only while the job runs
--   notes_cancel_job     Stop
--
-- A job still runs as its owner: the documents it saves pass the documents'
-- own policies. These functions only guard the job rows.
--
-- Also: notes_documents.kind gets a format check. Kinds reach file names on
-- the server (a sheet's added sources); a kind is a short lowercase word.

-- 1 --------------------------------------------------------------------------

alter table public.notes_jobs add column worker uuid;

drop policy if exists notes_jobs_insert on public.notes_jobs;
drop policy if exists notes_jobs_update on public.notes_jobs;
revoke insert, update on public.notes_jobs from authenticated;

create or replace function public.notes_enqueue_job(
  p_folder uuid,
  p_kind text,
  p_service text,
  p_model text,
  p_params jsonb
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
  perform pg_advisory_xact_lock(hashtext('notes_jobs:' || v_uid::text));
  if (select count(*) from public.notes_jobs
      where owner_id = v_uid and status in ('queued', 'running')) >= 3 then
    raise exception 'too many jobs' using errcode = 'P0001';
  end if;
  if (select count(*) from public.notes_jobs
      where owner_id = v_uid and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too many jobs this hour' using errcode = 'P0001';
  end if;
  insert into public.notes_jobs (owner_id, folder_id, kind, service, model, params)
  values (v_uid, p_folder, p_kind, p_service, p_model, p_params)
  returning id into v_id;
  return v_id;
end;
$$;

-- Five lapsed leases in a row on one step, or six hours since it was filed,
-- and a job is given up on: a model too slow for the platform, or a row kept
-- alive on purpose, can't hold a server busy forever.
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
   where id = p_id and owner_id = v_uid
     and status = 'running' and lease_until < now() and attempts >= 5;

  update public.notes_jobs
     set status = 'error',
         log = log || 'Stopped: a run may take at most six hours.'::text,
         lease_until = null,
         worker = null,
         updated_at = now()
   where id = p_id and owner_id = v_uid
     and status in ('queued', 'running') and (lease_until is null or lease_until < now())
     and created_at < now() - interval '6 hours';

  return query
  update public.notes_jobs
     set status = 'running',
         lease_until = now() + make_interval(secs => least(greatest(p_lease_seconds, 30), 900)),
         attempts = attempts + 1,
         worker = gen_random_uuid(),
         updated_at = now()
   where id = p_id and owner_id = v_uid
     and (status = 'queued' or (status = 'running' and lease_until < now() and attempts < 5))
  returning *;
end;
$$;

-- A worker's save. False when the job is no longer this worker's — the
-- reader stopped it, or the lease lapsed and another worker took it — which
-- is the worker's cue to stop. `p_step_done`: a step finished, so the count
-- of tries that ran out of time starts again.
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
   where id = p_id and owner_id = v_uid and status = 'running' and worker = p_worker;
  return found;
end;
$$;

-- Stop. Returns the job's uploads, for the caller to remove; null when the
-- job was not going (already ended, or not the caller's).
create or replace function public.notes_cancel_job(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uploads jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  update public.notes_jobs
     set status = 'cancelled',
         log = log || 'Stopped.'::text,
         lease_until = null,
         worker = null,
         updated_at = now()
   where id = p_id and owner_id = auth.uid() and status in ('queued', 'running')
  returning coalesce(params -> 'uploads', '[]'::jsonb) into v_uploads;
  return v_uploads;
end;
$$;

revoke execute on function public.notes_enqueue_job(uuid, text, text, text, jsonb) from public, anon;
revoke execute on function public.notes_claim_job(uuid, integer) from public, anon;
revoke execute on function public.notes_job_progress(uuid, uuid, text, text[], jsonb, jsonb, integer, integer, integer, boolean) from public, anon;
revoke execute on function public.notes_cancel_job(uuid) from public, anon;
grant execute on function public.notes_enqueue_job(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.notes_claim_job(uuid, integer) to authenticated;
grant execute on function public.notes_job_progress(uuid, uuid, text, text[], jsonb, jsonb, integer, integer, integer, boolean) to authenticated;
grant execute on function public.notes_cancel_job(uuid) to authenticated;

-- 2 --------------------------------------------------------------------------

alter table public.notes_documents
  add constraint notes_documents_kind_format check (kind ~ '^[a-z][a-z-]{0,31}$');
