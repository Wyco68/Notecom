"use client";

// Browser side of web-service runs. Holds no keys: those live encrypted on
// the server (lib/ai/vault.ts) and the browser only ever learns which
// services have one, with the last four characters. Uploads go straight to
// the reader's own folder in storage, so no app request carries them.

import { createClient } from "@/lib/supabase/client";
import { isWebService, type WebService } from "./services";

export interface SavedService {
  service: WebService;
  hint: string;
  model: string | null;
}

let cached: Promise<{ ready: boolean; keys: SavedService[] }> | null = null;

/** The reader's saved services, fetched once per page and shared. */
export function savedServices(refresh = false): Promise<{ ready: boolean; keys: SavedService[] }> {
  if (!cached || refresh) {
    cached = fetch("/api/ai/keys", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { ready: false, keys: [] }))
      .then((d) => ({ ready: !!d.ready, keys: (d.keys ?? []).filter((k: SavedService) => isWebService(k.service)) }))
      .catch(() => ({ ready: false, keys: [] }));
  }
  return cached;
}

const RUNNER_KEY = "notecom.runner";

/** Who writes the next run: "claude-code" or a web service. Not sensitive. */
export function preferredRunner(): string | null {
  try {
    const v = localStorage.getItem(RUNNER_KEY);
    return v === "claude-code" || isWebService(v) ? v : null;
  } catch {
    return null;
  }
}

export function setPreferredRunner(runner: string) {
  try {
    localStorage.setItem(RUNNER_KEY, runner);
  } catch {
    // Not remembered this time.
  }
}

/** Removes what the earlier, browser-only version kept: keys in localStorage. */
export function clearLegacyKeys() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k === "notecom.ai" || k?.startsWith("notecom.ai:")) localStorage.removeItem(k);
    }
  } catch {
    // Storage unavailable: nothing was kept there either.
  }
}

export const MAX_JOB_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Uploads a job's files to the reader's own folder in storage. */
export async function uploadForJob(files: File[]): Promise<Array<{ path: string; name: string }>> {
  for (const f of files) {
    if (f.size > MAX_JOB_UPLOAD_BYTES) throw new Error(`"${f.name}" is over 20 MB. Export a smaller PDF.`);
  }
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error("sign in again to upload");
  const batch = crypto.randomUUID();
  const out: Array<{ path: string; name: string }> = [];
  for (const f of files) {
    const safe = f.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120) || "upload";
    const path = `${uid}/${batch}/${safe}`;
    const { error } = await supabase.storage.from("notes-job-uploads").upload(path, f, {
      contentType: f.type || "application/octet-stream",
      upsert: false,
    });
    if (error) throw new Error(`couldn't upload "${f.name}": ${error.message}`);
    out.push({ path, name: f.name });
  }
  return out;
}

/** Removes uploads whose job never started (the queue refused it). */
export async function discardUploads(uploads: Array<{ path: string }>): Promise<void> {
  if (!uploads.length) return;
  await createClient()
    .storage.from("notes-job-uploads")
    .remove(uploads.map((u) => u.path))
    .catch(() => {});
}
