// Client for the vaultd Go filesystem service.
//
// All persistence flows through here. See SPECIFICATION.md.

const VAULTD_URL = process.env.VAULTD_URL || "http://127.0.0.1:4321";
const VAULTD_TOKEN = process.env.VAULTD_TOKEN;

// "vaultd" (default, local desktop), "gcs" (read-only Vercel deployment
// backed by a Google Cloud Storage mirror — lib/vault/gcs.ts,
// docs/deploy-vercel-gcs.md) or "worker" (read-only Vercel deployment
// backed by the content-api Cloudflare Worker — lib/vault/worker.ts,
// docs/deploy-cloudflare-github.md). Only the read helpers branch on this;
// the write helpers are vaultd-only and never run remotely (middleware.ts
// 403s every mutating request in those deployments).
const VAULT_SOURCE = process.env.VAULT_SOURCE || "vaultd";

// True on the serverless read-only deployments (gcs/worker): no vaultd, no
// indexd, no Ollama — routes use this to skip reindexing, related and chat.
export function isRemoteVault(): boolean {
  return VAULT_SOURCE === "gcs" || VAULT_SOURCE === "worker";
}

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
  assignments: LessonEntry[];
}

async function call(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${VAULTD_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(VAULTD_TOKEN ? { "X-Auth-Token": VAULTD_TOKEN } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `vaultd ${res.status}`);
  }
  return data;
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
  if (VAULT_SOURCE === "gcs") return import("./gcs").then((m) => m.gcsLoadDoc(folder, id));
  if (VAULT_SOURCE === "worker") return import("./worker").then((m) => m.workerLoadDoc(folder, id));
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
  if (VAULT_SOURCE === "gcs") return import("./gcs").then((m) => m.gcsLoadDoc(folder, id));
  if (VAULT_SOURCE === "worker") return import("./worker").then((m) => m.workerLoadDoc(folder, id));
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

export function loadAssignment(
  folder: string,
  id: string
): Promise<{ html: string; title: string }> {
  if (VAULT_SOURCE === "gcs") return import("./gcs").then((m) => m.gcsLoadDoc(folder, id));
  if (VAULT_SOURCE === "worker") return import("./worker").then((m) => m.workerLoadDoc(folder, id));
  return call(`/assignment/${encodeURIComponent(folder)}/${encodeURIComponent(id)}`);
}

export function deleteAssignment(folder: string, id: string): Promise<{ ok: boolean }> {
  return call(`/assignment/${encodeURIComponent(folder)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function renameAssignment(
  folder: string,
  id: string,
  newTitle: string
): Promise<{ ok: boolean }> {
  return call(
    `/assignment/${encodeURIComponent(folder)}/${encodeURIComponent(id)}/rename`,
    { method: "POST", body: JSON.stringify({ newTitle }) }
  );
}

export function listTree(): Promise<{ folders: TreeFolder[] }> {
  if (VAULT_SOURCE === "gcs") return import("./gcs").then((m) => m.gcsListTree());
  if (VAULT_SOURCE === "worker") return import("./worker").then((m) => m.workerListTree());
  return call("/tree");
}
