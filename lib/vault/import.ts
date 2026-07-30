// Ingests Claude-authored vault files into Supabase.
//
// Generation happens outside the app: `/lect` and `/quiz` run in Claude Code on
// the user's own subscription and write vault/<folder>/index.json + *.html.
// This is the one path that turns those files into rows — and it only ever
// reads them. The app itself writes no files anywhere; Supabase is the store.
//
// Ported from the `stored` sidecar's importer, minus its "disk wins" rule,
// which existed to reconcile two copies of the truth. There is one copy now:
// vault/ is generation output, Supabase is the app, and an import moves content
// in that direction only.
//
// Where there is no vault/ directory — a VPS, or any box that only reads — this
// is a no-op. Nothing to import is the normal case, not an error.

import { readFile, readdir, stat } from "fs/promises";
import path from "path";
import { createFolder, saveDoc, type Kind } from "./store";

const VAULT_ROOT = process.env.VAULT_ROOT || path.join(process.cwd(), "vault");

// Same segment guard the sidecars used: these names reach a filesystem path.
const SAFE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

interface IndexEntry {
  id: string;
  slug: string;
  title: string;
  seq: number;
}

export interface ImportStats {
  folders: number;
  imported: number;
  skipped: number;
  errors: number;
}

/** Reads both index.json shapes: the current {lessons,quizzes} object and the
 *  legacy bare array (lessons only). An older shape with a retired
 *  `assignments` field still parses; the extra key is ignored. */
function parseIndex(raw: string): { lessons: IndexEntry[]; quizzes: IndexEntry[] } {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return { lessons: parsed, quizzes: [] };
  return { lessons: parsed.lessons ?? [], quizzes: parsed.quizzes ?? [] };
}

// The quiz- prefix is the vault's own collision guard: a lesson and a quiz may
// share an id within a folder.
const htmlFilename = (kind: Kind, id: string) =>
  kind === "quiz" ? `quiz-${id}.html` : `${id}.html`;

// Files this process has already imported, by mtime. /api/tree runs an import
// on every page load, and without this each one would re-read every lesson and
// ask the database to compare it — a query per document per page view, to learn
// that nothing changed. Deliberately per-process and not persisted: a fresh
// start re-checks everything, which is what makes a change from another device
// (or a hand-edited file) reliably picked up.
const seen: Map<string, number> =
  (globalThis as any).__vaultImportMtimes ??
  ((globalThis as any).__vaultImportMtimes = new Map());

export async function importVault(): Promise<ImportStats> {
  const st: ImportStats = { folders: 0, imported: 0, skipped: 0, errors: 0 };

  let entries;
  try {
    entries = await readdir(VAULT_ROOT, { withFileTypes: true });
  } catch {
    return st; // no vault on this box — nothing to ingest
  }

  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith(".") || !SAFE.test(ent.name)) continue;
    const folder = ent.name;

    let index;
    try {
      index = parseIndex(await readFile(path.join(VAULT_ROOT, folder, "index.json"), "utf8"));
    } catch {
      continue; // not a vault folder, or an index we can't read
    }

    // Created lazily, on the first document that actually needs saving: an
    // unchanged folder should cost nothing, and createFolder is a round trip.
    let folderReady = false;
    const ensureFolder = async () => {
      if (folderReady) return;
      await createFolder(folder);
      folderReady = true;
      st.folders++;
    };

    for (const [kind, list] of [
      ["lesson", index.lessons],
      ["quiz", index.quizzes],
    ] as Array<[Kind, IndexEntry[]]>) {
      for (const e of list) {
        if (!SAFE.test(e.id ?? "")) {
          st.errors++;
          continue;
        }
        const file = path.join(VAULT_ROOT, folder, htmlFilename(kind, e.id));
        let html: string;
        let mtime: number;
        try {
          mtime = (await stat(file)).mtimeMs;
          if (seen.get(file) === mtime) {
            st.skipped++;
            continue;
          }
          html = await readFile(file, "utf8");
        } catch {
          st.errors++;
          continue;
        }
        try {
          await ensureFolder();
          const changed = await saveDoc({
            folder,
            kind,
            docKey: e.id,
            slug: e.slug,
            title: e.title,
            seq: e.seq,
            html,
          });
          // Only remember a file the database has actually accepted, so a
          // failed save is retried on the next load rather than cached away.
          seen.set(file, mtime);
          if (changed) st.imported++;
          else st.skipped++;
        } catch {
          st.errors++;
        }
      }
    }
  }
  return st;
}
