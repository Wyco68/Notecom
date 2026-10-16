// Files a generated document into Supabase.
//
// The CLI used to pick the id, compute the next seq from vault/<folder>/
// index.json and write both files itself — naming and numbering done by a
// model, against a local directory the app then had to import from. Both are
// the app's now: the CLI returns HTML and nothing else, and this assigns the
// name and number from what Supabase already holds, then saves through the
// data layer like every other write (RLS decides whether it lands).

import { listFolderDocs, loadDoc, resequenceFolder, saveDoc } from "@/lib/vault/store";
import type { SheetMessage, SheetMeta, SheetReview, SheetSpec } from "@/lib/sheet/layout";
import { slugify } from "@/lib/vault/slug";
import { titleOf } from "./validate";

export interface SavedDoc {
  id: string;
  title: string;
}

export async function saveGenerated(
  folder: string,
  kind: "lect" | "quiz",
  html: string
): Promise<SavedDoc> {
  const docKind = kind === "quiz" ? "quiz" : "lesson";
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
 * Files a cheatsheet: a new one numbered after the folder's other sheets, or —
 * for an edit — a new version of `docKey`, its conversation extended by
 * `append`. The conversation is read back at save time, so two edits saved
 * one after the other both keep their turns.
 */
export async function saveSheet(
  folder: string,
  html: string,
  spec: SheetSpec,
  review: SheetReview | null,
  append: SheetMessage[],
  docKey?: string
): Promise<SavedDoc> {
  if (docKey) {
    const current = await loadDoc(folder, docKey, "sheet");
    const meta = (current.meta ?? {}) as Partial<SheetMeta>;
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
      html,
      meta: { spec: meta.spec ?? spec, review, messages: [...(meta.messages ?? []), ...append] },
    });
    return { id: docKey, title: current.title };
  }

  const title = `Cheatsheet: chapters ${spec.from}-${spec.to}`;
  const slug = slugify(title).toLowerCase();
  await resequenceFolder(folder, "sheet");
  const { sheets } = await listFolderDocs(folder);
  const seq = sheets.reduce((max, d) => Math.max(max, d.seq), 0) + 1;
  const taken = new Set(sheets.map((d) => d.id));
  const base = `${String(seq).padStart(2, "0")}-${slug}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  await saveDoc({ folder, kind: "sheet", docKey: id, slug, title, seq, html, meta: { spec, review, messages: append } });
  return { id, title };
}
