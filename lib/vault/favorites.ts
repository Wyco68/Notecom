// Starred files, kept in localStorage.
//
// Same reasoning as recent.ts: which files one person pins is per-device UI
// state, not shared knowledge, so it needs no table, no sync and no RLS. It
// also means a favourite survives losing access to a folder without leaking
// anything — the entry is just a reference the tree no longer resolves, and
// pruneFavorites drops it.

import type { LessonRef } from "./types";

export interface FavoriteEntry {
  folder: string;
  id: string;
  kind: "lesson" | "quiz";
  title: string;
}

const KEY = "lecture.favorites";

const sameRef = (a: FavoriteEntry, b: { folder: string; id: string; kind: string }) =>
  a.folder === b.folder && a.id === b.id && a.kind === b.kind;

export function readFavorites(): FavoriteEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: FavoriteEntry[]): FavoriteEntry[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Private mode / quota: favourites just don't persist this session.
  }
  return list;
}

export function isFavorite(ref: { folder: string; id: string; kind: string }): boolean {
  return readFavorites().some((f) => sameRef(f, ref));
}

/** Star or unstar, returning the new list. Newest first, like recents. */
export function toggleFavorite(ref: LessonRef, title: string): FavoriteEntry[] {
  const entry: FavoriteEntry = { folder: ref.folder, id: ref.id, kind: ref.kind, title };
  const current = readFavorites();
  return write(
    current.some((f) => sameRef(f, entry))
      ? current.filter((f) => !sameRef(f, entry))
      : [entry, ...current]
  );
}

/** Drop entries whose folder or file no longer exists in the tree. */
export function pruneFavorites(exists: (e: FavoriteEntry) => boolean): FavoriteEntry[] {
  return write(readFavorites().filter(exists));
}
