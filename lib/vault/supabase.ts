// Read-only Supabase data source for the HOSTED reader (Vercel), selected by
// VAULT_SOURCE=supabase. The desktop app never uses this — it reads the local
// `stored` sidecar (helper.ts). A hosted deployment has no stored/SQLite/vault,
// so it reads the synced content straight from Supabase's notes_* tables.
//
// Reads run as the signed-in user (lib/supabase/server.ts), never with a
// service-role key: since folders became shareable, Row Level Security is what
// decides which folders and documents come back. A signed-out visitor sees
// nothing, and a signed-in one sees exactly what they own, belong to, or may
// discover. This mirrors the shape helper.ts returns from stored, so callers
// don't care which source answered.
//
// No writes here: note content on a hosted box is read-only (middleware.ts
// blocks mutations; only /api/collab, which writes membership, is exempt).

import { createClient } from "@/lib/supabase/server";
import type { LessonEntry, TreeFolder } from "./helper";

// listTree groups readable documents under their folder, seeding every
// readable folder first so empty folders still appear — matching stored's
// /tree. Both queries are RLS-filtered, so no folder needs excluding by hand.
export async function listTreeFromSupabase(): Promise<{ folders: TreeFolder[] }> {
  const supabase = await createClient();

  const [{ data: folderRows, error: folderErr }, { data: docRows, error: docErr }] =
    await Promise.all([
      supabase.from("notes_folders").select("id,slug").eq("deleted", false).order("slug"),
      supabase
        .from("notes_documents")
        .select("folder_id,doc_key,slug,title,seq,kind")
        .eq("deleted", false)
        .order("seq"),
    ]);
  if (folderErr) throw new Error(folderErr.message);
  if (docErr) throw new Error(docErr.message);

  const byId = new Map<string, TreeFolder>();
  const out: TreeFolder[] = [];
  for (const f of folderRows ?? []) {
    const tf: TreeFolder = { name: f.slug, lessons: [], quizzes: [] };
    byId.set(f.id, tf);
    out.push(tf);
  }
  for (const d of docRows ?? []) {
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
  const supabase = await createClient();

  // Slugs are unique per owner, not globally, so this can match more than one
  // folder; the document lookup below is scoped to whichever of them the
  // caller can actually read.
  const { data: folders } = await supabase
    .from("notes_folders")
    .select("id")
    .eq("deleted", false)
    .eq("slug", folder);
  if (!folders?.length) {
    throw new Error(`${kind} not found`);
  }

  const { data: rows } = await supabase
    .from("notes_documents")
    .select("html,title")
    .eq("deleted", false)
    .eq("kind", kind)
    .eq("doc_key", id)
    .in(
      "folder_id",
      folders.map((f) => f.id)
    )
    .limit(1);
  if (!rows?.length) {
    // Indistinguishable from "exists but you may not read it" — deliberately,
    // so a probe can't confirm a private folder's contents.
    throw new Error(`${kind} not found`);
  }
  return { html: rows[0].html, title: rows[0].title };
}
