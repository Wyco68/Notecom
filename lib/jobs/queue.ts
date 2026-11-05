// The job outbox (notes_jobs, migrations 0034 and 0035), read and written
// as the signed-in reader. Reads go through RLS (a reader sees only their
// own jobs); every write goes through a function that checks the caller and
// the row's state itself — no job row is written directly.

import { createClient } from "@/lib/supabase/server";
import type { WebService } from "@/lib/ai/services";

export type JobKind = "lesson" | "quiz" | "pictures" | "sheet-write" | "sheet-edit" | "sheet-review";
export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface JobRow {
  id: string;
  owner_id: string;
  folder_id: string;
  kind: JobKind;
  service: WebService;
  model: string;
  status: JobStatus;
  params: Record<string, any>;
  state: Record<string, any>;
  log: string[];
  tokens_in: number;
  tokens_out: number;
  result: { id: string; title: string } | null;
  lease_until: string | null;
  attempts: number;
  /** the token of the worker holding the job; only it may save progress */
  worker: string | null;
  created_at: string;
  updated_at: string;
}

/** What the browser is shown of a job: no state, no params beyond the basics. */
export function publicJob(j: JobRow) {
  return {
    id: j.id,
    kind: j.kind,
    service: j.service,
    model: j.model,
    status: j.status,
    folder: String(j.params.folder ?? ""),
    sheet: j.params.spec ?? undefined,
    docKey: j.result?.id ?? j.params.docKey ?? undefined,
    request: j.params.request ?? undefined,
    log: j.log,
    tokens: { input: j.tokens_in, output: j.tokens_out },
    result: j.result,
    createdAt: j.created_at,
    updatedAt: j.updated_at,
  };
}

export class QueueFullError extends Error {}

/** A failure whose message is written for the reader and safe to show them. */
export class JobFailure extends Error {}

/** Files a job; one transaction with the three-at-a-time check. */
export async function enqueue(
  folderId: string,
  kind: JobKind,
  service: WebService,
  model: string,
  params: Record<string, unknown>
): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notes_enqueue_job", {
    p_folder: folderId,
    p_kind: kind,
    p_service: service,
    p_model: model,
    p_params: params,
  });
  if (error) {
    if (error.message.includes("too many jobs this hour")) throw new QueueFullError("30 runs in the last hour — wait a while before starting another");
    if (error.message.includes("too many jobs")) throw new QueueFullError("3 runs are already going — wait for one to finish");
    throw new Error(error.message);
  }
  return data as string;
}

/** Takes the job for this worker, or null when another worker holds it or it is finished. */
export async function claim(id: string, leaseSeconds: number): Promise<JobRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notes_claim_job", { p_id: id, p_lease_seconds: leaseSeconds });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as JobRow[];
  return rows[0] ?? null;
}

export async function getJob(id: string): Promise<JobRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("notes_jobs").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as JobRow) ?? null;
}

/** Jobs still going, and the ones that ended in the last hour. */
export async function recentJobs(): Promise<JobRow[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data, error } = await supabase
    .from("notes_jobs")
    .select("*")
    .or(`status.in.(queued,running),updated_at.gte.${since}`)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []) as JobRow[];
}

/**
 * Saves a worker's progress. False when the job is no longer this worker's —
 * the reader cancelled it, or its lease lapsed and another worker took it —
 * which is the worker's cue to stop.
 */
export async function writeProgress(
  job: Pick<JobRow, "id" | "worker">,
  fields: Pick<JobRow, "status" | "log" | "state" | "result" | "tokens_in" | "tokens_out">,
  opts: { leaseSeconds?: number; stepDone?: boolean } = {}
): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notes_job_progress", {
    p_id: job.id,
    p_worker: job.worker,
    p_status: fields.status,
    p_log: fields.log,
    p_state: fields.state,
    p_result: fields.result,
    p_tokens_in: fields.tokens_in,
    p_tokens_out: fields.tokens_out,
    p_lease_seconds: opts.leaseSeconds ?? 0,
    p_step_done: !!opts.stepDone,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

/** A web-service step already going on this sheet: a sheet takes one step at a time. */
export async function activeSheetJob(docKey: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes_jobs")
    .select("id")
    .in("status", ["queued", "running"])
    .like("kind", "sheet-%")
    .eq("params->>docKey", docKey)
    .limit(1);
  if (error) throw new Error(error.message);
  return !!data?.length;
}

/** Stop: true when the job was still going. Its uploads go with it. */
export async function cancelJob(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notes_cancel_job", { p_id: id });
  if (error) throw new Error(error.message);
  if (data === null || data === undefined) return false;
  // A worker still on it notices at its next save and stops; the uploads it
  // would have read are gone either way.
  await removeUploads(Array.isArray(data) ? (data as Upload[]) : []).catch(() => {});
  return true;
}

// --- uploads ----------------------------------------------------------------

const BUCKET = "notes-job-uploads";

export interface Upload {
  path: string;
  name: string;
}

/** A job's upload, read as the reader (the bucket's policies are per reader). */
export async function readUpload(u: Upload): Promise<File> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(u.path);
  if (error || !data) throw new JobFailure(`the upload "${u.name}" is gone — start again`);
  return new File([await data.arrayBuffer()], u.name);
}

export async function removeUploads(uploads: Upload[]): Promise<void> {
  const paths = uploads.map((u) => u?.path).filter((p): p is string => typeof p === "string");
  if (!paths.length) return;
  const supabase = await createClient();
  await supabase.storage.from(BUCKET).remove(paths);
}

/**
 * Removes the reader's uploads that no job will read: a batch a day old that
 * no queued or running job names (its page closed between uploading and
 * filing the job, say). Jobs remove their own when they end.
 */
export async function sweepUploads(owner: string, active: JobRow[]): Promise<void> {
  const supabase = await createClient();
  const bucket = supabase.storage.from(BUCKET);
  const { data: batches } = await bucket.list(owner, { limit: 50 });
  const inUse = new Set(
    active.flatMap((j) => (Array.isArray(j.params.uploads) ? j.params.uploads : [])).map((u: Upload) => String(u?.path ?? "").split("/")[1])
  );
  const dayAgo = Date.now() - 24 * 60 * 60_000;
  for (const b of batches ?? []) {
    if (b.id !== null || inUse.has(b.name)) continue; // a file at the top, or still needed
    const { data: files } = await bucket.list(`${owner}/${b.name}`, { limit: 10 });
    if (!files?.length || files.some((f) => Date.parse(f.created_at ?? "") > dayAgo)) continue;
    await bucket.remove(files.map((f) => `${owner}/${b.name}/${f.name}`));
  }
}

/** An upload path a reader may name: their own folder, one file. */
export function ownUploadPath(owner: string, path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.startsWith(`${owner}/`) &&
    /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/.test(path)
  );
}
