"use client";

import type { Folder, LessonRef } from "@/lib/vault/types";
import FileTreeNode from "./FileTreeNode";
import TagGroup from "./TagGroup";
import { SkeletonRows } from "../layout/Skeleton";

// The tree itself comes from stored/SQLite (/api/tree) and knows nothing about
// tags — tags are collaboration state and live in Supabase. AppShell fetches
// them separately and passes them in here as a slug→tags map, so this stays a
// flat list on a purely-local install and groups only when there is something
// to group by.

const UNTAGGED = "Untagged";

export default function FileTree({
  folders,
  selected,
  tagsByFolder,
  favorites,
  onSelect,
  onToggleFavorite,
  onChanged,
  onManage,
}: {
  folders: Folder[] | null;
  selected: LessonRef | null;
  /** folder slug → its tag slugs. Empty/absent means "don't group". */
  tagsByFolder?: Record<string, string[]>;
  /** Keys of starred files, as `kind:folder:id`. */
  favorites: Set<string>;
  onSelect: (ref: LessonRef) => void;
  onToggleFavorite: (ref: LessonRef, title: string) => void;
  onChanged: () => void;
  /** Show a folder's sharing console in place. Absent → navigate to its page. */
  onManage?: (slug: string) => void;
}) {
  if (!folders) {
    return <SkeletonRows rows={6} />;
  }

  if (folders.length === 0) {
    return <p className="px-2 py-1 text-sm text-gray-500 dark:text-gray-500">No folders yet.</p>;
  }

  // Wrapped so the top-level folders can stagger in as the tree arrives. The
  // delay is capped: past the first handful the wait would cost readability
  // rather than buying any sense of sequence.
  const node = (folder: Folder, i: number) => (
    <div
      key={folder.name}
      style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}
      className="ui-rise"
    >
      <FileTreeNode
        folder={folder}
        selected={selected}
        favorites={favorites}
        onSelect={onSelect}
        onToggleFavorite={onToggleFavorite}
        onChanged={onChanged}
        onManage={onManage}
      />
    </div>
  );

  // A folder carrying several tags appears under each of them: the sidebar is
  // a set of views onto the same folders, not a filesystem where a folder has
  // one home.
  const groups = new Map<string, Folder[]>();
  for (const folder of folders) {
    const tags = tagsByFolder?.[folder.name] ?? [];
    for (const tag of tags.length ? tags : [UNTAGGED]) {
      const list = groups.get(tag);
      if (list) list.push(folder);
      else groups.set(tag, [folder]);
    }
  }

  // Nothing is tagged (or collaboration is off): keep the original flat tree
  // rather than burying every folder under one "Untagged" heading.
  const onlyUntagged = groups.size === 1 && groups.has(UNTAGGED);
  if (onlyUntagged) return <div>{folders.map(node)}</div>;

  // Untagged sorts last; everything else alphabetically.
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    a === UNTAGGED ? 1 : b === UNTAGGED ? -1 : a.localeCompare(b)
  );

  return (
    <div>
      {ordered.map(([tag, list]) => (
        <TagGroup key={tag} tag={tag} count={list.length}>
          {list.map(node)}
        </TagGroup>
      ))}
    </div>
  );
}
