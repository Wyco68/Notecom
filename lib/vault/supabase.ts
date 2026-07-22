// Read-only Supabase data source for the HOSTED reader (Vercel), selected by
// VAULT_SOURCE=supabase. The desktop app never uses this — it reads the local
// `stored` sidecar (helper.ts). A hosted deployment has no stored/SQLite/vault,
// so it reads the synced content straight from Supabase's notes_* tables.
//
// Server-only: the service key lives in a serverless env var and never reaches
// the client (route handlers call these; the browser never does). Reads bypass
// RLS via the service role — the tables have RLS on with zero policies by
// design. This mirrors the shape helper.ts returns from stored, so callers
// don't care which source answered. No writes here: the hosted box runs with
// READ_ONLY=1 (middleware.ts blocks every mutation).
//
// Folders and documents are joined in-process by folder_id: the remote tables
// carry no declared foreign key, so PostgREST resource embedding isn't
// available.

import type { LessonEntry, TreeFolder } from "./helper";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sb(path: string): Promise<any> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("VAULT_SOURCE=supabase but SUPABASE_URL/SUPABASE_SERVICE_KEY are not set");
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`supabase ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

// listTree groups active documents under their folder, seeding every active
// folder first so empty folders still appear — matching stored's /tree.
export async function listTreeFromSupabase(): Promise<{ folders: TreeFolder[] }> {
  const [folderRows, docRows] = (await Promise.all([
    sb("notes_folders?deleted=eq.false&select=id,slug&order=slug"),
    sb("notes_documents?deleted=eq.false&select=folder_id,doc_key,slug,title,seq,kind&order=seq"),
  ])) as [
    { id: string; slug: string }[],
    { folder_id: string; doc_key: string; slug: string; title: string; seq: number; kind: string }[]
  ];

  const byId = new Map<string, TreeFolder>();
  const out: TreeFolder[] = [];
  for (const f of folderRows) {
    const tf: TreeFolder = { name: f.slug, lessons: [], quizzes: [] };
    byId.set(f.id, tf);
    out.push(tf);
  }
  for (const d of docRows) {
    const tf = byId.get(d.folder_id);
    if (!tf) continue;
    const entry: LessonEntry = { id: d.doc_key, slug: d.slug, title: d.title, seq: d.seq };
    if (d.kind === "quiz") tf.quizzes.push(entry);
    else tf.lessons.push(entry);
  }
  return { folders: out };
}

export async function loadDocFromSupabase(
  folder: string,
  id: string,
  kind: "lesson" | "quiz"
): Promise<{ html: string; title: string }> {
  const folders = (await sb(
    `notes_folders?deleted=eq.false&slug=eq.${encodeURIComponent(folder)}&select=id&limit=1`
  )) as { id: string }[];
  if (!folders.length) {
    throw new Error(`${kind} not found`);
  }
  const rows = (await sb(
    `notes_documents?deleted=eq.false&folder_id=eq.${folders[0].id}` +
      `&kind=eq.${encodeURIComponent(kind)}&doc_key=eq.${encodeURIComponent(id)}` +
      `&select=html,title&limit=1`
  )) as { html: string; title: string }[];
  if (!rows.length) {
    throw new Error(`${kind} not found`);
  }
  return { html: rows[0].html, title: rows[0].title };
}
