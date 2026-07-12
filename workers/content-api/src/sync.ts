import { getBranchHead, getRawFile, getTree } from "./github";
import type { Env, LessonEntry, Manifest, TreeFolder } from "./types";

// Repo layout mirrors vault/:
//   <folder>/index.json      { lessons, quizzes, assignments }
//   <folder>/<id>.html       lesson/quiz/assignment HTML
//   .search-index.json       prebuilt keyword index
// Anything else in the repo (README, .gitattributes, ...) is ignored.

type PathKind = "doc" | "index" | "search" | null;

function classify(path: string): PathKind {
  if (path === ".search-index.json") return "search";
  const parts = path.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (parts[1] === "index.json") return "index";
  if (parts[1].endsWith(".html")) return "doc";
  return null;
}

function titleFromHtml(html: string, fallback: string): string {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() || fallback : fallback;
}

interface IndexJson {
  lessons?: LessonEntry[];
  quizzes?: LessonEntry[];
  assignments?: LessonEntry[];
}

// Same normalization as vaultd / lib/vault/gcs.ts: accept the
// {lessons,quizzes,assignments} object or a legacy bare array (lessons only).
function normalizeIndex(raw: unknown): Required<IndexJson> {
  const obj: IndexJson = Array.isArray(raw)
    ? { lessons: raw as LessonEntry[] }
    : ((raw as IndexJson) ?? {});
  const bySeq = (a: LessonEntry, b: LessonEntry) => a.seq - b.seq;
  return {
    lessons: [...(obj.lessons ?? [])].sort(bySeq),
    quizzes: [...(obj.quizzes ?? [])].sort(bySeq),
    assignments: [...(obj.assignments ?? [])].sort(bySeq),
  };
}

function kvKey(path: string): string {
  const kind = classify(path);
  if (kind === "search") return "search-index";
  const [folder, file] = path.split("/");
  if (kind === "index") return `idx:${folder}`;
  return `doc:${folder}/${file.slice(0, -".html".length)}`;
}

export interface SyncResult {
  synced: boolean;
  commitSha: string;
  changed: number;
  removed: number;
}

export async function syncFromGitHub(env: Env, headSha?: string): Promise<SyncResult> {
  const sha = headSha || (await getBranchHead(env));
  const manifest = await env.CONTENT.get<Manifest>("manifest", "json");
  if (manifest?.commitSha === sha) {
    return { synced: false, commitSha: sha, changed: 0, removed: 0 };
  }

  const blobs = (await getTree(env, sha)).filter((b) => classify(b.path) !== null);
  const files: Record<string, string> = {};
  for (const b of blobs) files[b.path] = b.sha;

  const changed = blobs.filter((b) => manifest?.files[b.path] !== b.sha);
  const removed = Object.keys(manifest?.files ?? {}).filter((p) => !(p in files));

  // Fetched index.json bodies kept in memory so the tree rebuild below
  // doesn't depend on read-after-write KV consistency.
  const fetchedIndexes = new Map<string, string>();
  let indexTouched = removed.some((p) => classify(p) === "index");

  for (const b of changed) {
    const body = await getRawFile(env, b.path, sha);
    const kind = classify(b.path);
    if (kind === "index") {
      indexTouched = true;
      fetchedIndexes.set(b.path, body);
      await env.CONTENT.put(kvKey(b.path), body);
    } else if (kind === "doc") {
      const id = b.path.split("/")[1].slice(0, -".html".length);
      await env.CONTENT.put(kvKey(b.path), body, {
        metadata: { title: titleFromHtml(body, id) },
      });
    } else {
      await env.CONTENT.put("search-index", body, { metadata: { sha: b.sha } });
    }
  }

  for (const p of removed) {
    await env.CONTENT.delete(kvKey(p));
  }

  if (indexTouched || !manifest) {
    const folders: TreeFolder[] = [];
    for (const path of Object.keys(files).filter((p) => classify(p) === "index")) {
      const name = path.split("/")[0];
      const body =
        fetchedIndexes.get(path) ?? (await env.CONTENT.get(kvKey(path))) ?? "{}";
      let idx: Required<IndexJson>;
      try {
        idx = normalizeIndex(JSON.parse(body));
      } catch {
        idx = { lessons: [], quizzes: [], assignments: [] };
      }
      folders.push({ name, ...idx });
    }
    folders.sort((a, b) => a.name.localeCompare(b.name));
    await env.CONTENT.put("tree", JSON.stringify({ folders }));
  }

  const next: Manifest = { commitSha: sha, syncedAt: Date.now(), files };
  await env.CONTENT.put("manifest", JSON.stringify(next));
  return { synced: true, commitSha: sha, changed: changed.length, removed: removed.length };
}
