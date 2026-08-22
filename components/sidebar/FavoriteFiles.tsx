"use client";

import QuizIcon from "../icons/QuizIcon";
import StarIcon from "../icons/StarIcon";
import type { FavoriteEntry } from "@/lib/vault/favorites";
import type { LessonRef } from "@/lib/vault/types";

// Starred files. Renders nothing when empty, so the sidebar gains a section
// only once the user has actually pinned something.
export default function FavoriteFiles({
  entries,
  selected,
  onSelect,
  onToggle,
  folderNames,
}: {
  entries: FavoriteEntry[];
  selected: LessonRef | null;
  onSelect: (ref: LessonRef) => void;
  onToggle: (ref: LessonRef, title: string) => void;
  /** slug -> display name, so a renamed folder shows its current name here too. */
  folderNames?: Record<string, string>;
}) {
  if (!entries.length) return null;

  return (
    <div className="border-b border-black/10 px-2 py-2 dark:border-white/10">
      <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
        Favorites
      </p>
      {entries.map((entry, i) => {
        const ref: LessonRef = { folder: entry.folder, id: entry.id, kind: entry.kind };
        const isActive =
          selected?.folder === entry.folder &&
          selected?.id === entry.id &&
          selected?.kind === entry.kind;
        return (
          <div
            key={`${entry.kind}:${entry.folder}:${entry.id}`}
            style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}
            className="ui-rise group flex items-center"
          >
            <button
              onClick={() => onSelect(ref)}
              title={`${entry.title} — ${folderNames?.[entry.folder] ?? entry.folder.replace(/-/g, " ")}`}
              className={`ui-row flex min-w-0 flex-1 items-center gap-1.5 truncate px-2 py-1 text-left text-sm ${
                isActive
                  ? "bg-blue-600/10 text-blue-700 dark:bg-blue-600/20 dark:text-blue-300"
                  : "text-gray-700 dark:text-gray-300"
              }`}
            >
              {entry.kind === "quiz" && (
                <QuizIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              )}
              <span className="truncate">{entry.title}</span>
            </button>
            <button
              onClick={() => onToggle(ref, entry.title)}
              title="Remove from favorites"
              aria-label={`Remove ${entry.title} from favorites`}
              className="ui-icon-btn mr-1 h-5 w-5 text-amber-500 hover:text-amber-500 dark:text-amber-500 dark:hover:text-amber-400"
            >
              <StarIcon className="h-3.5 w-3.5" filled />
            </button>
          </div>
        );
      })}
    </div>
  );
}
