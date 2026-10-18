// The files a cheatsheet run reads. Fetched by the route as the caller (RLS
// decides, as for any read) and written to the run's temp dir: the CLI has no
// database access, so it only ever sees what that request could. Every step —
// writing, an edit, the review — reads its sources afresh, so a lesson changed
// since the sheet was made is what counts.

import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { listFolderDocs, loadDoc, readMedia } from "@/lib/vault/store";
import type { SourceRef } from "./layout";

export interface SheetInputs {
  dir: string;
  chapters: Array<{ seq: number; path: string }>;
  /** documents added beyond the chapter range: quizzes, other lessons */
  docs: Array<{ ref: SourceRef; path: string }>;
  first: number;
  last: number;
}

/**
 * The chapters `from`..`to` of a folder plus any added documents, as files.
 * null when the folder holds no lessons in the range. An added document that
 * has since been deleted is skipped, not fatal.
 */
export async function writeSheetInputs(
  folder: string,
  from: number,
  to: number,
  refs: SourceRef[] = []
): Promise<SheetInputs | null> {
  const { lessons } = await listFolderDocs(folder);
  const chosen = lessons.filter((l) => l.seq >= from && l.seq <= to);
  if (!chosen.length) return null;

  const dir = path.join(tmpdir(), "notes-sheets", randomUUID());
  await mkdir(dir, { recursive: true });
  const chapters: SheetInputs["chapters"] = [];
  for (const l of chosen) {
    const { html, title } = await loadDoc(folder, l.id, "lesson");
    const file = path.join(dir, `ch${String(l.seq).padStart(2, "0")}.html`);
    const pictures = await writePictures(dir, html);
    await writeFile(file, `<!-- chapter ${l.seq} -->\n${pictures}<h1>${l.seq}. ${escapeText(title)}</h1>\n${blockPerLine(html)}\n`);
    chapters.push({ seq: l.seq, path: file });
  }

  const docs: SheetInputs["docs"] = [];
  for (const [i, ref] of refs.entries()) {
    try {
      const { html, title } = await loadDoc(folder, ref.id, ref.kind);
      const file = path.join(dir, `added-${i + 1}-${ref.kind}.html`);
      await writeFile(file, `<!-- ${ref.kind}: ${escapeText(title)} -->\n<h1>${escapeText(title)}</h1>\n${blockPerLine(html)}\n`);
      docs.push({ ref: { ...ref, title }, path: file });
    } catch {
      // Deleted or no longer readable: the sheet goes on without it.
    }
  }
  return { dir, chapters, docs, first: chosen[0].seq, last: chosen[chosen.length - 1].seq };
}

/** Kept for the start route's name; a sheet's first write has no added docs. */
export const writeChapters = (folder: string, from: number, to: number) => writeSheetInputs(folder, from, to);

// One block per line: Read cuts very long lines, and a lesson is often stored
// as one.
function blockPerLine(html: string): string {
  return html.replace(/(<(?:h[1-6]|p|li|tr|table|ul|ol|pre|blockquote|div|figure)[\s>])/g, "\n$1");
}

/**
 * The slide pictures a chapter shows, as files the run can look at, and a
 * comment for the chapter file saying which file is which picture. The run
 * places a picture on the sheet by the lesson's own src; it only opens the
 * file to judge whether the picture earns its space.
 */
async function writePictures(dir: string, html: string): Promise<string> {
  const srcs = new Set([...html.matchAll(/<img\s[^>]*\bsrc="(\/api\/media\/[^"]+)"/g)].map((m) => m[1]));
  if (!srcs.size) return "";
  await mkdir(path.join(dir, "pictures"), { recursive: true });
  // All at once: one by one, a picture-rich chapter took a minute to fetch
  // before the run could even start.
  const lines = await Promise.all(
    [...srcs].map(async (src) => {
      const media = await readMedia(src);
      if (!media) return null;
      const file = path.join(dir, "pictures", src.split("/").pop()!);
      await writeFile(file, media.data);
      return `${src} = ${file}`;
    })
  );
  const found = lines.filter((l): l is string => l !== null);
  return found.length ? `<!-- slide pictures (src = file to look at):\n${found.join("\n")}\n-->\n` : "";
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}
