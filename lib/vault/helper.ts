// Client for the vaultd Go filesystem service.
//
// All persistence flows through here. See SPECIFICATION.md.

const VAULTD_URL = process.env.VAULTD_URL || "http://127.0.0.1:4321";

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
  const res = await fetch(`${VAULTD_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
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
  return call("/tree");
}
