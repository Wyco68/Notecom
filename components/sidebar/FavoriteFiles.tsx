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
}: {
  entries: FavoriteEntry[];
  selected: LessonRef | null;
  onSelect: (ref: LessonRef) => void;
  onToggle: (ref: LessonRef, title: string) => void;
}) {
  if (!entries.length) return null;

  return (
    <div className="border-b border-black/10 px-2 py-2 dark:border-white/10">
      <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
        Favorites
      </p>
      {entries.map((entry) => {
        const ref: LessonRef = { folder: entry.folder, id: entry.id, kind: entry.kind };
        const isActive =
          selected?.folder === entry.folder &&
          selected?.id === entry.id &&
          selected?.kind === entry.kind;
        return (
          <div key={`${entry.kind}:${entry.folder}:${entry.id}`} className="group flex items-center">
            <button
              onClick={() => onSelect(ref)}
              title={`${entry.title} — ${entry.folder.replace(/-/g, " ")}`}
              className={`flex min-w-0 flex-1 items-center gap-1.5 truncate rounded px-2 py-1 text-left text-sm ${
                isActive
                  ? "bg-blue-600/10 text-blue-700 dark:bg-blue-600/20 dark:text-blue-300"
                  : "text-gray-700 hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/5"
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
              className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-amber-500 hover:bg-black/5 dark:hover:bg-white/10"
            >
              <StarIcon className="h-3.5 w-3.5" filled />
            </button>
          </div>
        );
      })}
    </div>
  );
}
