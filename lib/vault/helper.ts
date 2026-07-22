// Client for stored, the Go primary-datastore service (SQLite source of
// truth). Same wire contract vaultd had, so only this base URL changed when
// the runtime moved off the filesystem (offline-first migration).
//
// All persistence flows through here. See SPECIFICATION.md.

import { listTreeFromSupabase, loadDocFromSupabase } from "./supabase";

const STORED_URL = process.env.STORED_URL || "http://127.0.0.1:4323";
const STORED_TOKEN = process.env.STORED_TOKEN;

// Hosted read-only deployments (Vercel) have no local stored/SQLite/vault, so
// they read the synced content straight from Supabase. VAULT_SOURCE=supabase
// selects that; unset (the desktop default) keeps every call on stored. Only
// the read paths branch — writes are blocked by middleware on a READ_ONLY box.
const FROM_SUPABASE = process.env.VAULT_SOURCE === "supabase";

export interface LessonEntry {
  id: string;
  slug: string;
  title: string;
  seq: number;
}

export interface TreeFolder {
  name: string;
  lessons: LessonEntry[];
  quizzes: LessonEntry[];
}

async function call(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${STORED_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(STORED_TOKEN ? { "X-Auth-Token": STORED_TOKEN } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `stored ${res.status}`);
  }
  return data;
}

// syncFromVault ingests Claude-authored vault files (written via /lect,
// /quiz) into SQLite. Awaited by /api/tree so content generated a moment ago
// is present in the very tree response that follows it. No-op in Supabase
// mode: there is no local vault to import from.
export async function syncFromVault(): Promise<void> {
  if (FROM_SUPABASE) return;
  await call("/import", { method: "POST" });
}

export function createFolder(name: string): Promise<{ ok: boolean }> {
  return call("/folder", { method: "POST", body: JSON.stringify({ name }) });
}

export function deleteFolder(name: string): Promise<{ ok: boolean }> {
  return call(`/folder/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function loadLesson(
  folder: string,
  id: string
): Promise<{ html: string; title: string }> {
  if (FROM_SUPABASE) return loadDocFromSupabase(folder, id, "lesson");
  return call(`/lesson/${encodeURIComponent(folder)}/${encodeURIComponent(id)}`);
}

export function deleteLesson(folder: string, id: string): Promise<{ ok: boolean }> {
  return call(`/lesson/${encodeURIComponent(folder)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function renameLesson(
  folder: string,
  id: string,
  newTitle: string
): Promise<{ ok: boolean }> {
  return call(
    `/lesson/${encodeURIComponent(folder)}/${encodeURIComponent(id)}/rename`,
    { method: "POST", body: JSON.stringify({ newTitle }) }
  );
}

export function loadQuiz(
  folder: string,
  id: string
): Promise<{ html: string; title: string }> {
  if (FROM_SUPABASE) return loadDocFromSupabase(folder, id, "quiz");
  return call(`/quiz/${encodeURIComponent(folder)}/${encodeURIComponent(id)}`);
}

export function deleteQuiz(folder: string, id: string): Promise<{ ok: boolean }> {
  return call(`/quiz/${encodeURIComponent(folder)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function renameQuiz(
  folder: string,
  id: string,
  newTitle: string
): Promise<{ ok: boolean }> {
  return call(
    `/quiz/${encodeURIComponent(folder)}/${encodeURIComponent(id)}/rename`,
    { method: "POST", body: JSON.stringify({ newTitle }) }
  );
}

export function listTree(): Promise<{ folders: TreeFolder[] }> {
  if (FROM_SUPABASE) return listTreeFromSupabase();
  return call("/tree");
}
