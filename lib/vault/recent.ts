// Recently opened files, kept in localStorage.
//
// Deliberately client-only: "what did I look at last" is per-device UI state,
// not shared knowledge, so it needs no table, no sync and no RLS. Storing it
// server-side would also make it readable history, which this app has no
// reason to keep.
//
// An entry is recorded when the reader *leaves* a document, not when they open
// it — see AppShell. "Recent" then means "finished with", so the file you are
// currently reading is never also listed above the tree as history.

import type { LessonRef } from "./types";

export interface RecentEntry {
  folder: string;
  id: string;
  kind: "lesson" | "quiz";
  title: string;
}

const KEY = "lecture.recentFiles";
const LIMIT = 8;

const sameRef = (a: RecentEntry, b: { folder: string; id: string; kind: string }) =>
  a.folder === b.folder && a.id === b.id && a.kind === b.kind;

export function readRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Move a file to the front of the list, de-duplicating and capping length. */
export function pushRecent(ref: LessonRef, title: string): RecentEntry[] {
  const entry: RecentEntry = {
    folder: ref.folder,
    id: ref.id,
    kind: ref.kind,
    title,
  };
  const next = [entry, ...readRecent().filter((e) => !sameRef(e, entry))].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode / quota: recents simply don't persist this session.
  }
  return next;
}

/** Drop entries whose folder or file no longer exists in the tree. */
export function pruneRecent(exists: (e: RecentEntry) => boolean): RecentEntry[] {
  const next = readRecent().filter(exists);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Non-fatal, same as above.
  }
  return next;
}
