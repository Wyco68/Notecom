// Read-only Google Cloud Storage adapter for the vault.
//
// Used ONLY when VAULT_SOURCE=gcs — the Vercel/serverless read-only
// deployment (docs/deploy-vercel-gcs.md). The desktop/local app leaves
// VAULT_SOURCE unset and keeps talking to the local vaultd Go service, so
// none of this code runs there and the @google-cloud/storage SDK is never
// loaded.
//
// The bucket holds a mirror of the local vault/ tree:
//   <prefix>/<folder>/index.json      { lessons, quizzes, assignments }
//   <prefix>/<folder>/<id>.html       the semantic lesson HTML
//   <prefix>/.search-index.json       prebuilt keyword index (build script)
//
// Private bucket + service account: credentials come from
// GCS_SERVICE_ACCOUNT_KEY (the service-account JSON, raw or base64-encoded).

import type { TreeFolder, LessonEntry } from "./helper";

const BUCKET = process.env.GCS_BUCKET || "";
// Optional path prefix inside the bucket, e.g. "vault". No leading/trailing "/".
const PREFIX = (process.env.GCS_PREFIX || "").replace(/^\/+|\/+$/g, "");

function key(...parts: string[]): string {
  return [PREFIX, ...parts].filter(Boolean).join("/");
}

// Lazily create one Storage client for the process. Dynamic import keeps the
// heavy SDK out of the module graph until a request actually hits the GCS
// path, so the local desktop build never pays for it.
let bucketPromise: Promise<import("@google-cloud/storage").Bucket> | null = null;
function getBucket() {
  if (!bucketPromise) {
    bucketPromise = (async () => {
      if (!BUCKET) throw new Error("GCS_BUCKET is not set");
      const raw = process.env.GCS_SERVICE_ACCOUNT_KEY;
      if (!raw) throw new Error("GCS_SERVICE_ACCOUNT_KEY is not set");
      // Accept the JSON verbatim or base64-encoded — base64 is easier to
      // paste into a Vercel env var without newline mangling.
      const json = raw.trim().startsWith("{")
        ? raw
        : Buffer.from(raw, "base64").toString("utf8");
      const credentials = JSON.parse(json);
      const { Storage } = await import("@google-cloud/storage");
      const storage = new Storage({ projectId: credentials.project_id, credentials });
      return storage.bucket(BUCKET);
    })();
  }
  return bucketPromise;
}

async function download(path: string): Promise<Buffer> {
  const bucket = await getBucket();
  const [buf] = await bucket.file(path).download();
  return buf;
}

interface IndexJson {
  lessons?: LessonEntry[];
  quizzes?: LessonEntry[];
  assignments?: LessonEntry[];
}

// Mirror vaultd's loadIndexData: index.json is either the new
// {lessons,quizzes,assignments} object or a legacy bare array (lessons
// only). Normalize to the object shape and sort each list by seq so the
// sidebar order matches the desktop app.
function normalizeIndex(raw: unknown): Required<IndexJson> {
  const obj: IndexJson = Array.isArray(raw) ? { lessons: raw as LessonEntry[] } : (raw as IndexJson) ?? {};
  const bySeq = (a: LessonEntry, b: LessonEntry) => a.seq - b.seq;
  return {
    lessons: [...(obj.lessons ?? [])].sort(bySeq),
    quizzes: [...(obj.quizzes ?? [])].sort(bySeq),
    assignments: [...(obj.assignments ?? [])].sort(bySeq),
  };
}

// Build the sidebar tree by listing every <folder>/index.json in the bucket
// and parsing it — the GCS equivalent of vaultd's directory scan.
export async function gcsListTree(): Promise<{ folders: TreeFolder[] }> {
  const bucket = await getBucket();
  const [files] = await bucket.getFiles({ prefix: PREFIX ? PREFIX + "/" : "" });
  const indexPaths = files.map((f) => f.name).filter((n) => n.endsWith("/index.json"));

  const folders: TreeFolder[] = [];
  for (const p of indexPaths) {
    const rel = PREFIX ? p.slice(PREFIX.length + 1) : p;
    const name = rel.slice(0, -"/index.json".length);
    if (!name || name.includes("/")) continue; // folders are single-level
    let idx: Required<IndexJson>;
    try {
      idx = normalizeIndex(JSON.parse((await download(p)).toString("utf8")));
    } catch {
      idx = { lessons: [], quizzes: [], assignments: [] };
    }
    folders.push({ name, lessons: idx.lessons, quizzes: idx.quizzes, assignments: idx.assignments });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  return { folders };
}

function titleFromHtml(html: string, fallback: string): string {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() || fallback : fallback;
}

// Lessons, quizzes and assignments all live as <folder>/<id>.html, so one
// loader covers every kind.
export async function gcsLoadDoc(
  folder: string,
  id: string
): Promise<{ html: string; title: string }> {
  const html = (await download(key(folder, `${id}.html`))).toString("utf8");
  return { html, title: titleFromHtml(html, id) };
}

// --- keyword search -------------------------------------------------------
// indexd (FTS5 + vector RAG) can't run on serverless, so search is served
// from a prebuilt keyword index (scripts/build-search-index.mjs) stored in
// the bucket. One small JSON, cached in module scope with a short TTL.

interface SearchEntry {
  folder: string;
  id: string;
  kind: "lesson" | "quiz" | "assignment";
  seq: number;
  title: string;
  heading: string;
  headingIndex: number;
  text: string;
}

let searchCache: { at: number; entries: SearchEntry[] } | null = null;

async function loadSearchEntries(): Promise<SearchEntry[]> {
  if (searchCache && Date.now() - searchCache.at < 60_000) return searchCache.entries;
  let entries: SearchEntry[] = [];
  try {
    const parsed = JSON.parse((await download(key(".search-index.json"))).toString("utf8"));
    entries = (parsed.entries ?? []) as SearchEntry[];
  } catch {
    entries = [];
  }
  searchCache = { at: Date.now(), entries };
  return entries;
}

export interface GcsSearchResult {
  folder: string;
  id: string;
  kind: "lesson" | "quiz" | "assignment";
  title: string;
  topic: string;
  heading: string;
  summary: string;
  keywords: string;
  seq: number;
  headingIndex: number;
  score: number;
}

export async function gcsSearch(
  q: string,
  limit = 12
): Promise<{ mode: "keyword"; results: GcsSearchResult[] }> {
  const terms = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
  if (terms.length === 0) return { mode: "keyword", results: [] };

  const entries = await loadSearchEntries();
  const scored: { e: SearchEntry; score: number }[] = [];
  for (const e of entries) {
    const title = e.title.toLowerCase();
    const heading = e.heading.toLowerCase();
    const text = e.text.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 5;
      if (heading.includes(t)) score += 3;
      score += text.split(t).length - 1; // occurrence count in body
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
