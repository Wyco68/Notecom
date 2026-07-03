"use client";

import { useState } from "react";
import type { Folder, LessonRef } from "@/lib/vault/types";
import ConfirmModal from "../modals/ConfirmModal";
import TrashIcon from "../icons/TrashIcon";
import QuizIcon from "../icons/QuizIcon";
import AssignmentIcon from "../icons/AssignmentIcon";
import { useToast } from "../toast/ToastProvider";

type PendingDelete =
  | { kind: "folder" }
  | { kind: "lesson"; id: string; title: string }
  | { kind: "quiz"; id: string; title: string }
  | { kind: "assignment"; id: string; title: string };

export default function FileTreeNode({
  folder,
  selected,
  onSelect,
  onChanged,
}: {
  folder: Folder;
  selected: LessonRef | null;
  onSelect: (ref: LessonRef) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // Tolerate a tree response that omits either array (e.g. an older vaultd
  // binary that predates quizzes) instead of throwing on `.length`/`.map`.
  const lessons = folder.lessons ?? [];
  const quizzes = folder.quizzes ?? [];
  const assignments = folder.assignments ?? [];

  async function confirmDelete() {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "folder") {
        const res = await fetch(`/api/folders/${encodeURIComponent(folder.name)}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("failed");
        toast.success(`Deleted folder "${folder.name.replace(/-/g, " ")}".`);
      } else {
        const base =
          pending.kind === "quiz"
            ? "/api/quiz"
            : pending.kind === "assignment"
            ? "/api/assignment"
            : "/api/lesson";
        const res = await fetch(
          `${base}/${encodeURIComponent(folder.name)}/${encodeURIComponent(pending.id)}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error("failed");
        toast.success(`Deleted ${pending.kind} "${pending.title}".`);
      }
      onChanged();
    } catch {
      toast.error(
        pending.kind === "folder"
          ? `Could not delete folder "${folder.name.replace(/-/g, " ")}".`
          : `Could not delete ${pending.kind} "${pending.title}".`
      );
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <div className="mb-1">
      <div className="group flex items-center">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm text-gray-800 hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/5"
        >
          <span className="text-gray-500">{open ? "▾" : "▸"}</span>
          <span className="truncate font-medium">{folder.name.replace(/-/g, " ")}</span>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setPending({ kind: "folder" });
          }}
          title="Delete folder"
          className="mr-1 hidden h-5 w-5 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-red-500/10 hover:text-red-400 group-hover:flex"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && (
        <div className="ml-4 border-l border-black/10 pl-2 dark:border-white/10">
          {lessons.length === 0 && (
            <p className="px-2 py-1 text-xs text-gray-500">No lessons yet</p>
          )}
          {lessons.map((lesson) => {
            const isActive =
              selected?.folder === folder.name &&
              selected?.id === lesson.id &&
              selected?.kind === "lesson";
            return (
              <div key={lesson.id} className="group flex items-center">
                <button
                  onClick={() => onSelect({ folder: folder.name, id: lesson.id, kind: "lesson" })}
                  className={`flex-1 truncate rounded px-2 py-1 text-left text-sm ${
                    isActive
                      ? "bg-blue-600/10 text-blue-700 dark:bg-blue-600/20 dark:text-blue-300"
                      : "text-gray-700 hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/5"
                  }`}
                  title={lesson.title}
                >
                  {lesson.title}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPending({ kind: "lesson", id: lesson.id, title: lesson.title });
                  }}
                  title="Delete lesson"
                  className="mr-1 hidden h-5 w-5 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-red-500/10 hover:text-red-400 group-hover:flex"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}

          {quizzes.length > 0 && (
            <p className="px-2 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
              Quizzes
            </p>
          )}
          {quizzes.map((quiz) => {
            const isActive =
              selected?.folder === folder.name &&
              selected?.id === quiz.id &&
              selected?.kind === "quiz";
            return (
              <div key={quiz.id} className="group flex items-center">
                <button
                  onClick={() => onSelect({ folder: folder.name, id: quiz.id, kind: "quiz" })}
                  className={`flex flex-1 items-center gap-1.5 truncate rounded px-2 py-1 text-left text-sm ${
                    isActive
                      ? "bg-blue-600/10 text-blue-700 dark:bg-blue-600/20 dark:text-blue-300"
                      : "text-gray-700 hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/5"
                  }`}
                  title={quiz.title}
                >
                  <QuizIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span className="truncate">{quiz.title}</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPending({ kind: "quiz", id: quiz.id, title: quiz.title });
                  }}
                  title="Delete quiz"
                  className="mr-1 hidden h-5 w-5 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-red-500/10 hover:text-red-400 group-hover:flex"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}

          {assignments.length > 0 && (
            <p className="px-2 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
              Assignments
            </p>
          )}
          {assignments.map((assignment) => {
            const isActive =
              selected?.folder === folder.name &&
              selected?.id === assignment.id &&
              selected?.kind === "assignment";
            return (
              <div key={assignment.id} className="group flex items-center">
                <button
                  onClick={() => onSelect({ folder: folder.name, id: assignment.id, kind: "assignment" })}
                  className={`flex flex-1 items-center gap-1.5 truncate rounded px-2 py-1 text-left text-sm ${
                    isActive
                      ? "bg-blue-600/10 text-blue-700 dark:bg-blue-600/20 dark:text-blue-300"
                      : "text-gray-700 hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/5"
                  }`}
                  title={assignment.title}
                >
                  <AssignmentIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span className="truncate">{assignment.title}</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPending({ kind: "assignment", id: assignment.id, title: assignment.title });
                  }}
                  title="Delete assignment"
                  className="mr-1 hidden h-5 w-5 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-red-500/10 hover:text-red-400 group-hover:flex"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {pending && (
        <ConfirmModal
          title={
            pending.kind === "folder"
              ? "Delete folder"
              : pending.kind === "quiz"
              ? "Delete quiz"
              : pending.kind === "assignment"
              ? "Delete assignment"
              : "Delete lesson"
          }
          message={
            pending.kind === "folder"
              ? `Delete folder "${folder.name.replace(/-/g, " ")}" and all its lessons? This cannot be undone.`
              : `Delete ${pending.kind} "${pending.title}"? This cannot be undone.`
          }
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
