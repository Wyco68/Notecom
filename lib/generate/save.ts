// Files a generated document into Supabase.
//
// The CLI used to pick the id, compute the next seq from vault/<folder>/
// index.json and write both files itself — naming and numbering done by a
// model, against a local directory the app then had to import from. Both are
// the app's now: the CLI returns HTML and nothing else, and this assigns the
// name and number from what Supabase already holds, then saves through the
// data layer like every other write (RLS decides whether it lands).

import { listFolderDocs, loadDoc, resequenceFolder, saveDoc, saveMedia } from "@/lib/vault/store";
import { reviewOf, type SheetMeta, type SheetSpec } from "@/lib/sheet/layout";
import { slugify } from "@/lib/vault/slug";
import { titleOf } from "./validate";
import type { Picture } from "./runner";

export interface SavedDoc {
  id: string;
  title: string;
}

export async function saveGenerated(
  folder: string,
  kind: "lect" | "quiz",
  generated: string,
  pictures: Map<string, Picture> = new Map()
): Promise<SavedDoc> {
  const docKind = kind === "quiz" ? "quiz" : "lesson";
  const html = await attachPictures(folder, generated, pictures);
  const title = titleOf(html) || "Untitled";
  // Document slugs are lowercase, unlike folder slugs — the rule /lect and
  // /quiz always used, kept so new ids read like the existing ones.
  const slug = slugify(title).toLowerCase();

  // Lessons and quizzes number independently within a folder.
  await resequenceFolder(folder, docKind);
  const docs = await listFolderDocs(folder);
  const list = docKind === "quiz" ? docs.quizzes : docs.lessons;
  const seq = list.reduce((max, d) => Math.max(max, d.seq), 0) + 1;
  // Renumbering leaves old keys in place, so "<seq>-<slug>" can already name a
  // live document with the same title; overwriting it would lose that one.
  const taken = new Set(list.map((d) => d.id));
  const base = `${String(seq).padStart(2, "0")}-${slug}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;

  await saveDoc({ folder, kind: docKind, docKey: id, slug, title, seq, html });
  return { id, title };
}

/**
 * Saves a lesson that a picture-mode run added slide pictures to: same key,
 * number, name and title, new HTML.
 */
export async function savePictures(
  folder: string,
  docKey: string,
  placed: string,
  pictures: Map<string, Picture>
): Promise<SavedDoc> {
  const { lessons } = await listFolderDocs(folder);
  const entry = lessons.find((d) => d.id === docKey);
  if (!entry) throw new Error("lesson not found");
  const current = await loadDoc(folder, docKey, "lesson");
  const html = await attachPictures(folder, placed, pictures);
  await saveDoc({ folder, kind: "lesson", docKey, slug: entry.slug, title: current.title, seq: entry.seq, html });
  return { id: docKey, title: current.title };
}

/**
 * Uploads the pictures a document uses and points each <img> at its stored
 * copy, with its size — so a page reserves the space before it loads, and
 * a cheatsheet can be laid out before every picture has arrived. A run names
 * a picture by its file name only; this is where it gets an address.
 */
async function attachPictures(folder: string, html: string, pictures: Map<string, Picture>): Promise<string> {
  let out = html;
  for (const [name, pic] of pictures) {
    const src = await saveMedia(folder, pic.data, pic.ext);
    out = out.split(`src="${name}"`).join(`src="${src}" width="${pic.width}" height="${pic.height}"`);
  }
  return out;
}

/**
 * Saves one version of a cheatsheet: a new sheet, numbered after the folder's
 * other sheets, or — with `docKey` — the next version of that one. `html` null
 * keeps the stored fragment (a review only changes the meta). `update` gets
 * the stored meta, read at save time so steps that save one after another
 * never drop each other's changes, and returns the new one.
 */
export async function saveSheetVersion(
  folder: string,
  docKey: string | undefined,
  html: string | null,
  spec: SheetSpec,
  update: (meta: SheetMeta) => SheetMeta
): Promise<SavedDoc> {
  const fresh = (): SheetMeta => ({ spec, review: { reviewed: [], issues: {} }, checks: [], pending: [], messages: [] });

  if (docKey) {
    const current = await loadDoc(folder, docKey, "sheet");
    const stored = (current.meta ?? {}) as Partial<SheetMeta>;
    const meta: SheetMeta = { ...fresh(), ...stored, spec: stored.spec ?? spec, review: reviewOf(stored as SheetMeta) };
    const { sheets } = await listFolderDocs(folder);
    const entry = sheets.find((d) => d.id === docKey);
    if (!entry) throw new Error("cheatsheet not found");
    await saveDoc({
      folder,
      kind: "sheet",
      docKey,
      slug: entry.slug,
      title: current.title,
      seq: entry.seq,
      html: html ?? current.html,
      meta: update(meta),
    });
    return { id: docKey, title: current.title };
  }

  if (html === null) throw new Error("nothing to save");
  const title = `Cheatsheet: chapters ${spec.from}-${spec.to}`;
  const slug = slugify(title).toLowerCase();
  await resequenceFolder(folder, "sheet");
  const { sheets } = await listFolderDocs(folder);
  const seq = sheets.reduce((max, d) => Math.max(max, d.seq), 0) + 1;
  const taken = new Set(sheets.map((d) => d.id));
  const base = `${String(seq).padStart(2, "0")}-${slug}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  await saveDoc({ folder, kind: "sheet", docKey: id, slug, title, seq, html, meta: update(fresh()) });
  return { id, title };
}
