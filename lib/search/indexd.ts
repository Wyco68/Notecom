// Client for the indexd Go search service.
//
// The Next.js app never chunks or ranks anything — it only forwards queries
// here. See docs/architecture.md. This is the only TypeScript caller of
// indexd endpoints; don't fetch() indexd from anywhere else.

const INDEXD_URL = process.env.INDEXD_URL || "http://127.0.0.1:4322";
const INDEXD_TOKEN = process.env.INDEXD_TOKEN;

export interface SearchResult {
  folder: string;
  id: string;
  kind: "lesson" | "quiz";
  title: string;
  topic: string;
  heading: string;
  summary: string;
  keywords: string;
  seq: number;
  headingIndex: number;
  score: number;
  html?: string;
}

export interface RelatedResult {
  folder: string;
  id: string;
  kind: "lesson" | "quiz";
  title: string;
  score: number;
}

async function call(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${INDEXD_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(INDEXD_TOKEN ? { "X-Auth-Token": INDEXD_TOKEN } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `indexd ${res.status}`);
  }
  return data;
}

export function search(params: {
  q: string;
  folder?: string;
  kind?: string;
  limit?: number;
}): Promise<{ mode: "keyword"; results: SearchResult[] }> {
  const qs = new URLSearchParams({ q: params.q });
  if (params.folder) qs.set("folder", params.folder);
  if (params.kind) qs.set("kind", params.kind);
  if (params.limit) qs.set("limit", String(params.limit));
  return call(`/search?${qs}`);
}

export function related(
  folder: string,
  id: string,
  kind: string
): Promise<{ results: RelatedResult[] }> {
  return call(
    `/related/${encodeURIComponent(folder)}/${encodeURIComponent(id)}?kind=${encodeURIComponent(kind)}`
  );
}

// Fire-and-forget: indexd answers 202 immediately and scans in the
// background; a down indexd is not an error worth surfacing.
export function triggerReindex(): void {
  fetch(`${INDEXD_URL}/reindex`, {
    method: "POST",
    headers: INDEXD_TOKEN ? { "X-Auth-Token": INDEXD_TOKEN } : undefined,
  }).catch(() => {});
}
