// The app's data layer: Supabase, directly.
//
// Every read and write goes straight to Postgres as the signed-in user. There
// is no local database and no sync step — what a device shows is what the
// server has, on the desktop app, in development and on a VPS alike. The
// `stored` sidecar that used to own a local SQLite copy is gone, and with it
// the whole class of "this box is a version behind" bugs.
//
// Anon key only, so Row Level Security decides everything: which folders come
// back, which documents inside them, and whether a write is allowed at all.
// This file never checks permissions itself — a frontend or route-handler check
// would be a second, weaker copy of the rules in supabase/migrations/0003.
// See docs/collaboration.md.
//
// Content is generated outside the app (Claude Code writes vault/*.html) and
// ingested by lib/vault/import.ts; nothing here writes files.

import { createClient } from "@/lib/supabase/server";
import { chunkHTML } from "@/lib/search/chunker";

export interface LessonEntry {
  id: string;
  slug: string;
  title: string;
  seq: number;
}

export type Kind = "lesson" | "quiz";

/** Rows the app writes; `id` and the timestamps are ours to supply — the
 *  columns predate this app's schema migrations and carry no defaults. */
const nowISO = () => new Date().toISOString();

// `cause` is the raw Supabase/Postgres error — table, column, constraint and
// RLS policy names in plain text. Logging it and throwing only `message`
// keeps that detail out of every route handler's response body; every caller
// of `fail()` already treats the thrown message as the thing shown to the
// client (see e.g. app/api/tree/route.ts), so this changes nothing about how
// callers use it, only what a caller who isn't supposed to see it learns.
function fail(message: string, cause?: { message: string } | null): never {
  if (cause?.message) console.error(`[vault] ${message}:`, cause.message);
  throw new Error(message);
}

// --- folder resolution --------------------------------------------------------

// Slugs are unique per owner, not globally (notes_folders_owner_slug_key), so a
// slug can name more than one readable folder once folders are shared. Reads
// span all of them; writes pick the caller's own first and fall back to the
// rest, where RLS has the final say. Deterministic, and it means "my
// networking folder" always wins over someone else's.
async function folderIdsBySlug(slug: string): Promise<string[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("notes_folders")
    .select("id,owner_id")
    .eq("deleted", false)
    .eq("slug", slug);
  if (error) fail("folder lookup failed", error);
  const rows = data ?? [];
  rows.sort((a, b) => Number(b.owner_id === user?.id) - Number(a.owner_id === user?.id));
  return rows.map((r) => r.id);
}

async function requireFolderId(slug: string): Promise<string> {
  const [id] = await folderIdsBySlug(slug);
  if (!id) fail("folder not found");
  return id;
}

/**
 * Resolves a folder slug to an id the caller may write to, or null. For a
 * write path that happens entirely outside Supabase (lib/generate/runner.ts
 * spawns a local CLI process against a filesystem path, not a Supabase call),
 * so RLS never gets a chance to refuse it — this is a fail-fast check in
 * front of that, using the same `notes_can_write_folder` function RLS itself
 * calls, not a second copy of the rule. `folderIdsBySlug` already orders the
 * caller's own folder first, matching how every other write here resolves a
 * shared slug.
 */
export async function resolveWritableFolderId(slug: string): Promise<string | null> {
  const supabase = await createClient();
  const [id] = await folderIdsBySlug(slug);
  if (!id) return null;
  const { data, error } = await supabase.rpc("notes_can_write_folder", { p_folder: id });
  if (error) {
    console.error("[vault] write-permission check failed:", error.message);
    return null;
  }
  return data ? id : null;
}

// --- tree ---------------------------------------------------------------------

// The tree is read in two steps, and deliberately so.
//
// It used to be one query pair: every readable folder *and* every readable
// document, on every page load, window focus and refresh. That cost grew with
// the whole account while the sidebar showed a list of collapsed folder names —
// the reader waited for thousands of lesson rows to learn that they had eleven
// folders. Documents are now fetched per folder, when one is opened
// (`listFolderDocs`), which is the moment their titles are first visible.
//
// Both queries are RLS-filtered, so no folder needs excluding by hand.

/** Folder names only: the sidebar's first paint. */
export async function listFolders(): Promise<{ folders: { name: string; displayName: string }[] }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("notes_folders")
    .select("slug,name,owner_id")
    .eq("deleted", false)
    .order("slug");
  if (error) fail("tree failed", error);

  // A slug names one folder per owner, so a shared folder can collide with the
  // reader's own. They read as one folder everywhere else (`folderIdsBySlug`),
  // so they are one row here too — first occurrence wins the display name,
  // except the reader's own copy always wins over someone else's, matching
  // how a write to a shared slug is resolved.
  const bySlug = new Map<string, { name: string; ownerId: string }>();
  for (const r of data ?? []) {
    const cur = bySlug.get(r.slug);
    if (!cur || (r.owner_id === user?.id && cur.ownerId !== user?.id)) {
      bySlug.set(r.slug, { name: r.name, ownerId: r.owner_id });
    }
  }
  return {
    folders: [...bySlug.entries()].map(([slug, v]) => ({ name: slug, displayName: v.name })),
  };
}

/** One folder's documents. Spans every folder the slug resolves to, matching
 *  `loadDoc` — a document readable through a shared folder of the same name is
 *  listed by the same rule that opens it. */
export async function listFolderDocs(
  slug: string
): Promise<{ lessons: LessonEntry[]; quizzes: LessonEntry[] }> {
  const supabase = await createClient();
  const out: { lessons: LessonEntry[]; quizzes: LessonEntry[] } = { lessons: [], quizzes: [] };
  const folderIds = await folderIdsBySlug(slug);
  // No such folder and no readable folder are the same answer here: an empty
  // one, not an error — the same reason loadDoc refuses to distinguish them.
  if (!folderIds.length) return out;

  const { data, error } = await supabase
    .from("notes_documents")
    .select("doc_key,slug,title,seq,kind")
    .eq("deleted", false)
    .in("folder_id", folderIds)
    .order("seq");
  if (error) fail("folder contents failed", error);

  for (const d of data ?? []) {
    const entry: LessonEntry = { id: d.doc_key, slug: d.slug, title: d.title, seq: d.seq };
    if (d.kind === "quiz") out.quizzes.push(entry);
    else out.lessons.push(entry);
  }
  return out;
}

// --- folders ------------------------------------------------------------------

// Idempotent on slug, like the sidecar it replaces: an existing folder of the
// same name is returned rather than duplicated. New folders start private and
// undiscoverable — sharing is an explicit act performed later from the web UI,
// never a default.
//
// `displayName` defaults to `slug` for the one caller (lib/vault/import.ts)
// where they're genuinely the same string — a vault folder's on-disk name
// already is Claude Code's own kebab-case slug, nothing else to preserve.
// The in-app "create folder" route is the other caller, and passes both: a
// slug column exists precisely so casing/spacing typed by a person doesn't
// have to be thrown away to get one.
export async function createFolder(slug: string, displayName: string = slug): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) fail("sign in required");

  const { data: existing, error: lookupErr } = await supabase
    .from("notes_folders")
    .select("id")
    .eq("deleted", false)
    .eq("slug", slug)
    .eq("owner_id", user.id)
    .limit(1);
  if (lookupErr) fail("folder lookup failed", lookupErr);
  if (existing?.length) return { ok: true };

  const now = nowISO();
  const { error } = await supabase.from("notes_folders").insert({
    id: crypto.randomUUID(),
    slug,
    name: displayName,
    owner_id: user.id,
    visibility: "private",
    discoverable: false,
    join_policy: "request",
    created_at: now,
    updated_at: now,
    version: 1,
    deleted: false,
  });
  if (error) fail("create folder failed", error);
  return { ok: true };
}

// Soft delete, cascading to the folder's documents. Tombstones rather than
// hard deletes: a row that simply vanished would reappear the moment another
// device with an older copy wrote anything, and the collaboration UI still
// needs to tell "removed" apart from "never existed".
export async function deleteFolder(name: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const id = await requireFolderId(name);
  const now = nowISO();

  const { data: docs, error: docErr } = await supabase
    .from("notes_documents")
    .select("id,version")
    .eq("folder_id", id)
    .eq("deleted", false);
  if (docErr) fail("delete folder failed", docErr);

  for (const d of docs ?? []) {
    const { error } = await supabase
      .from("notes_documents")
      .update({ deleted: true, version: d.version + 1, updated_at: now })
      .eq("id", d.id);
    if (error) fail("delete folder failed", error);
  }

  const { data: folder } = await supabase
    .from("notes_folders")
    .select("version")
    .eq("id", id)
    .single();
  const { error } = await supabase
    .from("notes_folders")
    .update({ deleted: true, version: (folder?.version ?? 1) + 1, updated_at: now })
    .eq("id", id);
  if (error) fail("delete folder failed", error);
  return { ok: true };
}

// Display name only — the slug (identity, URLs, the vault directory it maps
// to) never changes, same rule renameDoc uses for a document's title.
export async function renameFolder(slug: string, newName: string): Promise<{ ok: boolean }> {
  if (!newName?.trim()) fail("name required");
  const supabase = await createClient();
  const id = await requireFolderId(slug);
  const { data: folder } = await supabase.from("notes_folders").select("version").eq("id", id).single();
  // Renaming is owner-only (notes_folders_update's `with check` requires
  // notes_can_manage_folder + owner_id = auth.uid()), unlike a document write,
  // which any editor may do. A member without manage rights has this update
  // filtered to zero rows by RLS with no Postgres error — `.select().single()`
  // is what turns that silent no-op into a real failure instead of a false
  // "ok: true" toast for a rename that never happened.
  const { error } = await supabase
    .from("notes_folders")
    .update({ name: newName.trim(), version: (folder?.version ?? 1) + 1, updated_at: nowISO() })
    .eq("id", id)
    .select("id")
    .single();
  if (error) fail("rename folder failed — you may not have permission to rename this folder", error);
  return { ok: true };
}

// --- documents ----------------------------------------------------------------

export async function loadDoc(
  folder: string,
  id: string,
  kind: Kind
): Promise<{ html: string; title: string }> {
  const supabase = await createClient();
  const folderIds = await folderIdsBySlug(folder);
  if (!folderIds.length) fail(`${kind} not found`);

  const { data: rows } = await supabase
    .from("notes_documents")
    .select("html,title")
    .eq("deleted", false)
    .eq("kind", kind)
    .eq("doc_key", id)
    .in("folder_id", folderIds)
    .limit(1);
  if (!rows?.length) {
    // Indistinguishable from "exists but you may not read it" — deliberately,
    // so a probe can't confirm a private folder's contents.
    fail(`${kind} not found`);
  }
  return { html: rows[0].html, title: rows[0].title };
}

async function findDoc(folder: string, id: string, kind: Kind) {
  const supabase = await createClient();
  const folderIds = await folderIdsBySlug(folder);
  if (!folderIds.length) fail(`${kind} not found`);
  const { data: rows } = await supabase
    .from("notes_documents")
    .select("id,version,folder_id")
    .eq("deleted", false)
    .eq("kind", kind)
    .eq("doc_key", id)
    .in("folder_id", folderIds)
    .limit(1);
  if (!rows?.length) fail(`${kind} not found`);
  return rows[0];
}

export async function deleteDoc(folder: string, id: string, kind: Kind): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const doc = await findDoc(folder, id, kind);
  const { error } = await supabase
    .from("notes_documents")
    .update({ deleted: true, version: doc.version + 1, updated_at: nowISO() })
    .eq("id", doc.id);
  if (error) fail(`delete ${kind} failed`, error);
  // Chunks are the searchable copy of a deleted document — drop them rather
  // than tombstone them, or search keeps answering with text nobody can open.
  await supabase.from("notes_doc_chunks").delete().eq("document_id", doc.id);
  return { ok: true };
}

// Title only: the document's id, key and slug are its identity and survive a
// rename, matching the sidecar's index-only rename.
export async function renameDoc(
  folder: string,
  id: string,
  kind: Kind,
  newTitle: string
): Promise<{ ok: boolean }> {
  if (!newTitle?.trim()) fail("title required");
  const supabase = await createClient();
  const doc = await findDoc(folder, id, kind);
  const { error } = await supabase
    .from("notes_documents")
    .update({ title: newTitle, version: doc.version + 1, updated_at: nowISO() })
    .eq("id", doc.id);
  if (error) fail(`rename ${kind} failed`, error);
  return { ok: true };
}

export interface SaveInput {
  folder: string;
  kind: Kind;
  /** folder-local key — the flat file stem, e.g. "01-intro" */
  docKey: string;
  slug: string;
  title: string;
  seq: number;
  html: string;
}

/** Upserts one document keyed by (folder, kind, docKey) and rebuilds its search
 *  chunks. Returns false when the content was already identical, so the caller
 *  can report how much of an import actually changed. */
export async function saveDoc(input: SaveInput): Promise<boolean> {
  const supabase = await createClient();
  const folderId = await requireFolderId(input.folder);
  const now = nowISO();

  const { data: rows, error: lookupErr } = await supabase
    .from("notes_documents")
    .select("id,version,html,title,slug,seq,deleted")
    .eq("folder_id", folderId)
    .eq("kind", input.kind)
    .eq("doc_key", input.docKey)
    .limit(1);
  if (lookupErr) fail("save failed", lookupErr);
  const existing = rows?.[0];

  if (
    existing &&
    !existing.deleted &&
    existing.html === input.html &&
    existing.title === input.title &&
    existing.slug === input.slug &&
    existing.seq === input.seq
  ) {
    // Identical on both sides: skip, so a re-import doesn't churn versions and
    // updated_at, and another device doesn't see a phantom edit.
    return false;
  }

  const id = existing?.id ?? crypto.randomUUID();
  const version = (existing?.version ?? 0) + 1;
  if (existing) {
    const { error } = await supabase
      .from("notes_documents")
      .update({
        slug: input.slug,
        title: input.title,
        seq: input.seq,
        html: input.html,
        updated_at: now,
        version,
        deleted: false,
      })
      .eq("id", id);
    if (error) fail("save failed", error);
  } else {
    const { error } = await supabase.from("notes_documents").insert({
      id,
      folder_id: folderId,
      kind: input.kind,
      doc_key: input.docKey,
      slug: input.slug,
      title: input.title,
      seq: input.seq,
      html: input.html,
      created_at: now,
      updated_at: now,
      version,
      deleted: false,
    });
    if (error) fail("save failed", error);
  }

  await writeChunks(id, folderId, input.html, version);
  return true;
}

// --- search index -------------------------------------------------------------

// Replaces a document's chunk set wholesale. Delete-then-insert rather than a
// diff: chunk boundaries move when a lesson is edited, so matching old rows to
// new ones would cost more than rewriting the handful of rows involved.
async function writeChunks(
  documentId: string,
  folderId: string,
  html: string,
  docVersion: number
): Promise<void> {
  const supabase = await createClient();
  const { chunks } = chunkHTML(html);

  const { error: delErr } = await supabase
    .from("notes_doc_chunks")
    .delete()
    .eq("document_id", documentId);
  if (delErr) fail("reindex failed", delErr);
  if (!chunks.length) return;

  const { error } = await supabase.from("notes_doc_chunks").insert(
    chunks.map((c, idx) => ({
      document_id: documentId,
      folder_id: folderId,
      idx,
      doc_version: docVersion,
      topic: c.topic,
      heading: c.heading,
      heading_index: c.headingIndex,
      summary: c.summary,
      keywords: c.keywords,
      body: c.body,
      html: c.html,
    }))
  );
  if (error) fail("reindex failed", error);
}

/**
 * Re-chunks every readable document whose index is missing or built from an
 * older version — documents written by another device, or by an app version
 * that predates the chunk table.
 *
 * Deliberately two-phase: the first pass reads only ids and versions, never
 * `html`. /api/tree calls this on every page load, and pulling every
 * document's full HTML just to discover there is nothing to do would make the
 * common case the expensive one.
 */
export async function reindexStale(limit = 25): Promise<number> {
  const supabase = await createClient();

  const [{ data: docs, error }, { data: chunks, error: chunkErr }] = await Promise.all([
    supabase.from("notes_documents").select("id,folder_id,version").eq("deleted", false),
    supabase.from("notes_doc_chunks").select("document_id,doc_version"),
  ]);
  if (error) fail("reindex failed", error);
  if (chunkErr) fail("reindex failed", chunkErr);

  const indexedAt = new Map<string, number>();
  for (const c of chunks ?? []) indexedAt.set(c.document_id, c.doc_version);

  const stale = (docs ?? [])
    .filter((d) => indexedAt.get(d.id) !== d.version)
    .slice(0, limit);
  if (!stale.length) return 0;

  const { data: bodies, error: bodyErr } = await supabase
    .from("notes_documents")
    .select("id,html")
    .in(
      "id",
      stale.map((d) => d.id)
    );
  if (bodyErr) fail("reindex failed", bodyErr);
  const htmlById = new Map((bodies ?? []).map((b) => [b.id, b.html]));

  let done = 0;
  for (const d of stale) {
    const html = htmlById.get(d.id);
    if (html === undefined) continue;
    await writeChunks(d.id, d.folder_id, html, d.version);
    done++;
  }
  return done;
}
