"use client";

import { useEffect, useState } from "react";
import type { Folder, FolderDocs, LessonRef } from "@/lib/vault/types";
import { SkeletonRows } from "../layout/Skeleton";
import ConfirmModal from "../modals/ConfirmModal";
import TrashIcon from "../icons/TrashIcon";
import StarIcon from "../icons/StarIcon";
import QuizIcon from "../icons/QuizIcon";
import ShareIcon from "../icons/ShareIcon";
import { useToast } from "../toast/ToastProvider";

// Collaboration entry point is only meaningful when the app is configured for
// it; otherwise the manage page just 501s, so the control is hidden.
const COLLAB_ENABLED = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

// The vault numbers files on disk (`01-introduction`, `seq: 1` in index.json);
// showing that same number in the tree keeps the sidebar order readable as an
// index rather than an arbitrary list.
function SeqBadge({ seq }: { seq: number }) {
  if (!Number.isFinite(seq) || seq <= 0) return null;
  return (
    <span className="shrink-0 tabular-nums text-xs text-gray-500 dark:text-gray-500">
      {String(seq).padStart(2, "0")}
    </span>
  );
}

type PendingDelete =
  | { kind: "folder" }
  | { kind: "lesson"; id: string; title: string }
  | { kind: "quiz"; id: string; title: string };

export default function FileTreeNode({
  folder,
  docs,
  selected,
  favorites,
  onSelect,
  onOpen,
  onToggleFavorite,
  onChanged,
  onManage,
}: {
  folder: Folder;
  /** This folder's documents, or undefined while they haven't been fetched. */
  docs?: FolderDocs;
  selected: LessonRef | null;
  /** Keys of starred files, as `kind:folder:id`. */
  favorites: Set<string>;
  onSelect: (ref: LessonRef) => void;
  /** Ask for this folder's documents. Idempotent — the shell holds them. */
  onOpen: (name: string) => void;
  onToggleFavorite: (ref: LessonRef, title: string) => void;
  onChanged: () => void;
  /** Show the sharing console in place. Absent → navigate to its own page. */
  onManage?: (slug: string) => void;
}) {
  // Folders start collapsed so a vault with many files reads as a tidy index
  // — click a folder to reveal its files.
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // Auto-open the folder that holds the current selection, so choosing a
  // lesson (or a search hit) reveals it in the tree even when collapsed.
  const containsSelected = selected?.folder === folder.name;
  useEffect(() => {
    if (containsSelected) setOpen(true);
  }, [containsSelected]);

  // Opening the folder is what fetches it — the whole point of not shipping
  // every document with the tree. Driven by `open` rather than by the click, so
  // the auto-open above pulls its contents too.
  useEffect(() => {
    if (open) onOpen(folder.name);
  }, [open, folder.name, onOpen]);

  // Tolerate a response that omits either array instead of throwing on
  // `.length`/`.map`.
  const lessons = docs?.lessons ?? [];
  const quizzes = docs?.quizzes ?? [];

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
        const base = pending.kind === "quiz" ? "/api/quiz" : "/api/lesson";
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
      {/* The action icons stay in the layout and only fade in on hover: the
          sidebar is a fixed width and these rows wrap, so anything that
          appears or disappears would reflow the row under the cursor. */}
      <div className="group flex items-center">
        <button
          onClick={() => setOpen((o) => !o)}
          className="ui-row flex min-w-0 flex-1 items-start gap-1.5 px-2 py-1.5 text-left text-sm text-gray-800 dark:text-gray-200"
        >
          {/* One glyph that rotates, rather than two that swap: a transform
              animates, a different character can only cut. */}
          <span
            className={`inline-block text-gray-500 transition-transform duration-150 ease-out ${
              open ? "rotate-90" : ""
            }`}
          >
            ▸
          </span>
          {/* Wraps rather than truncates: a folder name is how you find the
              folder, and the sidebar never scrolls sideways. */}
          <span className="break-words font-medium">{folder.name.replace(/-/g, " ")}</span>
        </button>
        {/* Opens the sharing console in the content column when the shell
            offers that, and navigates only as a fallback — a button that
            navigates and a link that doesn't are both lies about what happens. */}
        {COLLAB_ENABLED &&
          (onManage ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onManage(folder.name);
              }}
              title="Manage sharing"
              className="ui-icon-btn ui-reveal mr-1 h-5 w-5"
            >
              <ShareIcon className="h-3.5 w-3.5" />
            </button>
          ) : (
            <a
              href={`/vault/${encodeURIComponent(folder.name)}/manage`}
              title="Manage sharing"
              onClick={(e) => e.stopPropagation()}
              className="ui-icon-btn ui-reveal mr-1 h-5 w-5"
            >
              <ShareIcon className="h-3.5 w-3.5" />
            </a>
          ))}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setPending({ kind: "folder" });
          }}
          title="Delete folder"
          className="ui-icon-btn ui-icon-btn-danger ui-reveal mr-1 h-5 w-5"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Opening fades and lifts the contents in; the rows themselves stagger a
          little so a long folder reads as unfolding rather than appearing. The
          animation is opacity and transform only — animating the height here
          would reflow every row below it. */}
      {open && (
        <div className="ui-rise ml-4 border-l border-black/10 pl-2 dark:border-white/10">
          {/* Not yet fetched is not the same as empty: placeholder rows while
              the request is out, so the folder never reads as "No lessons yet"
              for a folder that has some. */}
          {!docs ? (
            <SkeletonRows rows={3} />
          ) : (
            lessons.length === 0 &&
            quizzes.length === 0 && (
              <p className="px-2 py-1 text-xs text-gray-500">No lessons yet</p>
            )
          )}
          {lessons.map((lesson, i) => {
            const isActive =
              selected?.folder === folder.name &&
              selected?.id === lesson.id &&
              selected?.kind === "lesson";
            return (
              <div
                key={lesson.id}
                style={{ animationDelay: `${Math.min(i, 8) * 20}ms` }}
                className="ui-rise group flex items-center"
              >
                <button
                  onClick={() => onSelect({ folder: folder.name, id: lesson.id, kind: "lesson" })}
                  className={`ui-row flex min-w-0 flex-1 items-start gap-1.5 px-2 py-1 text-left text-sm ${
                    isActive
                      ? "bg-blue-600/10 text-blue-700 dark:bg-blue-600/20 dark:text-blue-300"
                      : "text-gray-700 dark:text-gray-300"
                  }`}
                  title={lesson.title}
                >
                  <SeqBadge seq={lesson.seq} />
                  <span className="break-words">{lesson.title}</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(
                      { folder: folder.name, id: lesson.id, kind: "lesson" },
                      lesson.title
                    );
                  }}
                  title={
                    favorites.has(`lesson:${folder.name}:${lesson.id}`)
                      ? "Remove from favorites"
                      : "Add to favorites"
                  }
                  className={`ui-icon-btn mr-1 h-5 w-5 ${
                    favorites.has(`lesson:${folder.name}:${lesson.id}`)
                      ? "text-amber-500 hover:text-amber-500 dark:text-amber-500 dark:hover:text-amber-400"
                      : "ui-reveal"
                  }`}
                >
                  <StarIcon
                    className="h-3.5 w-3.5"
                    filled={favorites.has(`lesson:${folder.name}:${lesson.id}`)}
                  />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPending({ kind: "lesson", id: lesson.id, title: lesson.title });
                  }}
                  title="Delete lesson"
                  className="ui-icon-btn ui-icon-btn-danger ui-reveal mr-1 h-5 w-5"
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
          {quizzes.map((quiz, i) => {
            const isActive =
              selected?.folder === folder.name &&
              selected?.id === quiz.id &&
              selected?.kind === "quiz";
            return (
              <div
                key={quiz.id}
                style={{ animationDelay: `${Math.min(i, 8) * 20}ms` }}
                className="ui-rise group flex items-center"
              >
                <button
                  onClick={() => onSelect({ folder: folder.name, id: quiz.id, kind: "quiz" })}
                  className={`ui-row flex min-w-0 flex-1 items-start gap-1.5 px-2 py-1 text-left text-sm ${
                    isActive
                      ? "bg-blue-600/10 text-blue-700 dark:bg-blue-600/20 dark:text-blue-300"
                      : "text-gray-700 dark:text-gray-300"
                  }`}
                  title={quiz.title}
                >
                  <QuizIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <SeqBadge seq={quiz.seq} />
                  <span className="break-words">{quiz.title}</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(
                      { folder: folder.name, id: quiz.id, kind: "quiz" },
                      quiz.title
                    );
                  }}
                  title={
                    favorites.has(`quiz:${folder.name}:${quiz.id}`)
                      ? "Remove from favorites"
                      : "Add to favorites"
                  }
                  className={`ui-icon-btn mr-1 h-5 w-5 ${
                    favorites.has(`quiz:${folder.name}:${quiz.id}`)
                      ? "text-amber-500 hover:text-amber-500 dark:text-amber-500 dark:hover:text-amber-400"
                      : "ui-reveal"
                  }`}
                >
                  <StarIcon
                    className="h-3.5 w-3.5"
                    filled={favorites.has(`quiz:${folder.name}:${quiz.id}`)}
                  />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPending({ kind: "quiz", id: quiz.id, title: quiz.title });
                  }}
                  title="Delete quiz"
                  className="ui-icon-btn ui-icon-btn-danger ui-reveal mr-1 h-5 w-5"
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
