// Files a generated document into Supabase.
//
// The CLI used to pick the id, compute the next seq from vault/<folder>/
// index.json and write both files itself — naming and numbering done by a
// model, against a local directory the app then had to import from. Both are
// the app's now: the CLI returns HTML and nothing else, and this assigns the
// name and number from what Supabase already holds, then saves through the
// data layer like every other write (RLS decides whether it lands).

import { listFolderDocs, saveDoc } from "@/lib/vault/store";
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
  const docs = await listFolderDocs(folder);
  const list = docKind === "quiz" ? docs.quizzes : docs.lessons;
  const seq = list.reduce((max, d) => Math.max(max, d.seq), 0) + 1;
  const id = `${String(seq).padStart(2, "0")}-${slug}`;

  await saveDoc({ folder, kind: docKind, docKey: id, slug, title, seq, html });
  return { id, title };
}
