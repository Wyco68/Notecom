// The chapter files a cheatsheet run reads. Fetched by the route as the
// caller (RLS decides, as for any read) and written to the run's temp dir: the
// CLI has no database access, so it only ever sees what that request could.
// Shared by a new sheet and by every edit of a stored one — an edit reads its
// sources afresh, so a lesson changed since the sheet was made is what counts.

import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { listFolderDocs, loadDoc } from "@/lib/vault/store";

export interface SheetInputs {
  dir: string;
  chapters: Array<{ seq: number; path: string }>;
  first: number;
  last: number;
}

/** null when the folder holds no lessons numbered `from`..`to`. */
export async function writeChapters(folder: string, from: number, to: number): Promise<SheetInputs | null> {
  const { lessons } = await listFolderDocs(folder);
  const chosen = lessons.filter((l) => l.seq >= from && l.seq <= to);
  if (!chosen.length) return null;

  const dir = path.join(tmpdir(), "notes-sheets", randomUUID());
  await mkdir(dir, { recursive: true });
  const chapters: SheetInputs["chapters"] = [];
  for (const l of chosen) {
    const { html, title } = await loadDoc(folder, l.id, "lesson");
    const file = path.join(dir, `ch${String(l.seq).padStart(2, "0")}.html`);
    // One block per line: Read cuts very long lines, and a lesson is often
    // stored as one.
    const body = html.replace(/(<(?:h[1-6]|p|li|tr|table|ul|ol|pre|blockquote|div)[\s>])/g, "\n$1");
    await writeFile(file, `<!-- chapter ${l.seq} -->\n<h1>${l.seq}. ${escapeText(title)}</h1>\n${body}\n`);
    chapters.push({ seq: l.seq, path: file });
  }
  return { dir, chapters, first: chosen[0].seq, last: chosen[chosen.length - 1].seq };
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}
