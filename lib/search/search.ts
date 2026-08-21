// Search and "related documents", answered by Postgres.
//
// Replaces the `indexd` sidecar: same chunk granularity, same strict
// all-terms-must-match behaviour, same response shape — the ranking just moved
// from SQLite FTS5 into two functions in supabase/migrations/0015. The app
// still chunks and ranks nothing itself; it forwards a query and formats the
// answer. See docs/architecture.md.
//
// Both RPCs are SECURITY INVOKER, so results are already limited to folders the
// caller may read. There is no separate permission check here, and there must
// not be one.

import { createClient } from "@/lib/supabase/server";

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

export async function search(params: {
  q: string;
  folder?: string;
  kind?: string;
  limit?: number;
  /** include each hit's section HTML — only the reader's inline preview wants it */
  html?: boolean;
}): Promise<{ mode: "keyword"; results: SearchResult[] }> {
  const supabase = await createClient();
  // Clamped here rather than left to the RPC's own greatest/least: a
  // non-finite or absurd value from the query string would otherwise reach
  // notes_search_chunks as an out-of-range `integer` argument and come back
  // as a raw Postgres cast error instead of a bounded, valid limit.
  const limit = Math.min(Math.max(Number.isFinite(params.limit) ? params.limit! : 10, 1), 50);
  const { data, error } = await supabase.rpc("notes_search_chunks", {
    p_q: params.q,
    p_folder: params.folder ?? null,
    p_kind: params.kind ?? null,
    p_limit: limit,
  });
  if (error) {
    console.error("[search] notes_search_chunks failed:", error.message);
    throw new Error("search failed");
  }

  const results: SearchResult[] = (data ?? []).map((r: any) => ({
    folder: r.folder,
    id: r.id,
    kind: r.kind,
    title: r.title,
    topic: r.topic,
    heading: r.heading,
    summary: r.summary,
    keywords: r.keywords,
    seq: r.seq,
    headingIndex: r.heading_index,
    score: r.score,
    ...(params.html ? { html: r.html } : {}),
  }));
  // `mode` is always "keyword"; it stays in the response because callers
  // already read it.
  return { mode: "keyword", results };
}

export async function related(
  folder: string,
  id: string,
  kind: string
): Promise<{ results: RelatedResult[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notes_related_docs", {
    p_folder: folder,
    p_id: id,
    p_kind: kind,
    p_limit: 5,
  });
  if (error) {
    console.error("[search] notes_related_docs failed:", error.message);
    throw new Error("related lookup failed");
  }
  return { results: (data ?? []) as RelatedResult[] };
}
