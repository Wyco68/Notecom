"use client";

import QuizIcon from "../icons/QuizIcon";
import type { RecentEntry } from "@/lib/vault/recent";
import type { LessonRef } from "@/lib/vault/types";

// Recently opened files. Collapsed to nothing when empty (a fresh install has
// no history and an empty heading would just be noise), and capped short
// enough that it never competes with the folder tree for space.
export default function RecentFiles({
  entries,
  selected,
  onSelect,
}: {
  entries: RecentEntry[];
  selected: LessonRef | null;
  onSelect: (ref: LessonRef) => void;
}) {
  if (!entries.length) return null;

  return (
    <div className="border-b border-black/10 px-2 py-2 dark:border-white/10">
      <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
        Recent
      </p>
      {entries.map((entry) => {
        const isActive =
          selected?.folder === entry.folder &&
          selected?.id === entry.id &&
          selected?.kind === entry.kind;
        return (
          <button
            key={`${entry.kind}:${entry.folder}:${entry.id}`}
            onClick={() => onSelect({ folder: entry.folder, id: entry.id, kind: entry.kind })}
            title={`${entry.title} — ${entry.folder.replace(/-/g, " ")}`}
            className={`flex w-full items-center gap-1.5 truncate rounded px-2 py-1 text-left text-sm ${
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
        );
      })}
    </div>
  );
}
