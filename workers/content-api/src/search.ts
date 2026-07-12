import type { Env, SearchEntry, SearchResult } from "./types";

// Port of gcsSearch (lib/vault/gcs.ts) — same scoring so the two read-only
// deployments rank identically. Index parsed once per isolate, 60s TTL.

let cache: { at: number; entries: SearchEntry[] } | null = null;

async function loadEntries(env: Env): Promise<SearchEntry[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.entries;
  let entries: SearchEntry[] = [];
  try {
    const raw = await env.CONTENT.get("search-index");
    if (raw) entries = (JSON.parse(raw).entries ?? []) as SearchEntry[];
  } catch {
    entries = [];
  }
  cache = { at: Date.now(), entries };
  return entries;
}

export async function search(
  env: Env,
  q: string,
  limit = 12
): Promise<{ mode: "keyword"; results: SearchResult[] }> {
  const terms = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
  if (terms.length === 0) return { mode: "keyword", results: [] };

  const entries = await loadEntries(env);
  const scored: { e: SearchEntry; score: number }[] = [];
  for (const e of entries) {
    const title = e.title.toLowerCase();
    const heading = e.heading.toLowerCase();
    const text = e.text.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 5;
      if (heading.includes(t)) score += 3;
      score += text.split(t).length - 1;
    }
    if (score > 0) scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score);

  const results = scored.slice(0, limit).map(({ e, score }) => ({
    folder: e.folder,
    id: e.id,
    kind: e.kind,
    title: e.title,
    topic: "",
    heading: e.heading,
    summary: e.text.slice(0, 200),
    keywords: "",
    seq: e.seq,
    headingIndex: e.headingIndex,
    score,
  }));
  return { mode: "keyword", results };
}
