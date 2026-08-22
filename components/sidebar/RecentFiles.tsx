"use client";

import QuizIcon from "../icons/QuizIcon";
import type { RecentEntry } from "@/lib/vault/recent";
import type { LessonRef } from "@/lib/vault/types";

// Files the reader has finished with. Entries arrive when a document is closed
// or replaced, never when it is opened (see AppShell), so the file on screen is
// not simultaneously listed as history.
//
// Renders the rows only: the heading and the pane that fixes its share of the
// sidebar's height belong to AppShell, alongside the folder tree's, so the two
// panes are spelled the same way.
export default function RecentFiles({
  entries,
  selected,
  onSelect,
  folderNames,
}: {
  entries: RecentEntry[];
  selected: LessonRef | null;
  onSelect: (ref: LessonRef) => void;
  /** slug -> display name, so a renamed folder shows its current name here too. */
  folderNames?: Record<string, string>;
}) {
  if (!entries.length) {
    return (
      <p className="px-2 py-1 text-xs text-gray-500 dark:text-gray-500">
        Nothing yet — a file lands here once you move on from it.
      </p>
    );
  }

  return (
    <>
      {entries.map((entry, i) => {
        const isActive =
          selected?.folder === entry.folder &&
          selected?.id === entry.id &&
          selected?.kind === entry.kind;
        return (
          <button
            key={`${entry.kind}:${entry.folder}:${entry.id}`}
            onClick={() => onSelect({ folder: entry.folder, id: entry.id, kind: entry.kind })}
            title={`${entry.title} — ${folderNames?.[entry.folder] ?? entry.folder.replace(/-/g, " ")}`}
            style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}
            className={`ui-rise ui-row flex w-full min-w-0 items-center gap-1.5 overflow-hidden px-2 py-1 text-left text-sm ${
              isActive
                ? "bg-blue-600/10 text-blue-700 dark:bg-blue-600/20 dark:text-blue-300"
                : "text-gray-700 dark:text-gray-300"
            }`}
          >
            {entry.kind === "quiz" && (
              <QuizIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            )}
            {/* One line, always. Unlike the tree — where a folder name wraps
                because it is how you find the folder — a recent row has a fixed
                height budget, so a long title clips to an ellipsis and the
                `title` attribute above carries the whole name. `min-w-0` is what
                lets a flex child shrink far enough to truncate at all. */}
            <span className="min-w-0 flex-1 truncate">{entry.title}</span>
          </button>
        );
      })}
    </>
  );
}
