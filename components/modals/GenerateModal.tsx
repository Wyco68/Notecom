"use client";

import { useEffect, useRef, useState } from "react";
import type { Folder } from "@/lib/vault/types";
import Modal from "./Modal";
import FileDrop from "../generate/FileDrop";
import SpinnerIcon from "../icons/SpinnerIcon";
import CheckIcon from "../icons/CheckIcon";
import StopIcon from "../icons/StopIcon";
import AlertIcon from "../icons/AlertIcon";
import {
  MAX_CONCURRENT_JOBS,
  useGenerateJobs,
  type GenerateJob,
} from "../generate/GenerateJobsProvider";

// The folder the last run went into, per device: the next upload usually goes
// to the same subject.
const LAST_FOLDER_KEY = "lecture.lastGenerateFolder";

function initialFolder(folders: Folder[]): string {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_FOLDER_KEY);
  } catch {
    // Private mode: fall through to the first folder.
  }
  return folders.some((f) => f.name === last) ? last! : folders[0]?.name ?? "";
}

// Start a generation run, and watch one.
//
// The dialog does not own the run — GenerateJobsProvider does. That is what
// makes generation a background job: closing this returns the reader to their
// notes while the log keeps filling, the sidebar keeps a live row, and the tree
// refreshes itself when the document is saved. Reopening from that row lands
// back here on the same job.
export default function GenerateModal({
  folders,
  onClose,
  onSignIn,
  watchJobId,
}: {
  folders: Folder[];
  onClose: () => void;
  /** hand off to the sign-in modal when a run failed for lack of a session */
  onSignIn: () => void;
  /** open straight onto an existing job instead of the form */
  watchJobId?: string;
}) {
  const { jobs, activeCount, start, abort } = useGenerateJobs();
  const [folder, setFolder] = useState(() => initialFolder(folders));
  const [kind, setKind] = useState<"lect" | "quiz" | "pictures">("lect");
  // Picture mode adds a saved lesson's slide pictures to it; it needs that
  // lesson, picked from the chosen folder.
  const [lessons, setLessons] = useState<Array<{ id: string; title: string; seq: number }> | null>(null);
  const [lesson, setLesson] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [starting, setStarting] = useState(false);
  // The job this dialog is showing: the one it was opened on, or the one it
  // just started.
  const [watching, setWatching] = useState<string | null>(watchJobId ?? null);

  const job = jobs.find((j) => j.id === watching) ?? null;
  const atCapacity = activeCount >= MAX_CONCURRENT_JOBS;

  async function begin() {
    if (!file || !folder || starting) return;
    setStarting(true);
    try {
      localStorage.setItem(LAST_FOLDER_KEY, folder);
    } catch {
      // Not remembered this time; the run is unaffected.
    }
    try {
      const id = await start(
        kind === "pictures" ? { file, folder, kind: "lect", lesson } : { file, folder, kind }
      );
      if (id) setWatching(id);
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    if (kind !== "pictures" || !folder) return;
    let cancelled = false;
    setLessons(null);
    setLesson("");
    fetch(`/api/folders/${encodeURIComponent(folder)}`)
      .then((r) => (r.ok ? r.json() : { lessons: [] }))
      .then((d) => {
        if (!cancelled) setLessons(d.lessons ?? []);
      })
      .catch(() => {
        if (!cancelled) setLessons([]);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, folder]);

  // A job that finished and was dismissed from the sidebar takes its row with
  // it; there is nothing left to show, so close rather than sit on a blank panel.
  useEffect(() => {
    if (watching && !job) onClose();
  }, [watching, job, onClose]);

  if (job) {
    return (
      <Modal title={job.status === "running" ? "Generating" : "Generation"} onClose={onClose} size="md">
        <JobLog job={job} onAbort={() => abort(job.id)} onSignIn={onSignIn} />
        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="ui-btn ui-btn-sm ui-btn-secondary flex-1">
            {job.status === "running" ? "Keep running in background" : "Close"}
          </button>
          {job.status === "running" && (
            <button onClick={() => abort(job.id)} className="ui-btn ui-btn-sm ui-btn-danger-outline shrink-0">
              Stop
            </button>
          )}
        </div>
      </Modal>
    );
  }

  const types = [
    ["lect", "Lesson"],
    ["quiz", "Quiz"],
    ["pictures", "Pictures"],
  ] as const;

  return (
    <Modal title="Generate" onClose={onClose} size="md">
      <div className="space-y-5">
        <div>
          <label htmlFor="gen-folder" className="mb-1.5 block text-sm font-medium text-ink">
            Folder
          </label>
          <select id="gen-folder" value={folder} onChange={(e) => setFolder(e.target.value)} className="ui-field">
            {folders.map((f) => (
              <option key={f.name} value={f.name}>
                {f.displayName}
              </option>
            ))}
          </select>
        </div>

        <div role="radiogroup" aria-label="Type" className="grid grid-cols-3 gap-0.5 rounded-lg bg-ink/[0.05] p-0.5">
          {types.map(([k, label]) => (
            <button
              key={k}
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`ui-focus rounded-md py-1.5 text-sm transition-colors duration-150 ease-out ${
                kind === k ? "bg-raised font-semibold text-ink shadow-[0_1px_2px_rgb(var(--shadow)/0.12)]" : "text-ink-2 hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {kind === "pictures" && (
          <div>
            <label htmlFor="gen-lesson" className="mb-1.5 block text-sm font-medium text-ink">
              Lesson
            </label>
            <select
              id="gen-lesson"
              value={lesson}
              onChange={(e) => setLesson(e.target.value)}
              disabled={!lessons?.length}
              className="ui-field"
            >
              <option value="">{lessons === null ? "Loading…" : lessons.length ? "Choose a lesson" : "No lessons in this folder"}</option>
              {lessons?.map((l) => (
                <option key={l.id} value={l.id}>
                  {String(l.seq).padStart(2, "0")} {l.title}
                </option>
              ))}
            </select>
          </div>
        )}

        <FileDrop
          files={file ? [file] : []}
          onChange={(fs) => setFile(fs[0] ?? null)}
          label={kind === "pictures" ? "Drop the lesson's slides" : "Drop lecture slides or browse"}
        />

        <div className="flex items-center justify-between border-t border-line pt-4 text-sm">
          <span className="text-muted">Runs with</span>
          <span className="font-medium text-ink">Claude Code · this computer</span>
        </div>

        <div>
          <button
            onClick={begin}
            disabled={!file || !folder || starting || atCapacity || (kind === "pictures" && !lesson)}
            className="ui-btn ui-btn-primary w-full"
          >
            {starting ? "Starting…" : kind === "pictures" ? "Add pictures" : `Generate ${kind === "quiz" ? "quiz" : "lesson"}`}
          </button>
          {atCapacity && (
            <p className="mt-2 text-center text-xs text-warn">{activeCount} runs going. Wait for one to finish.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * The terminal view of one job: status line, token counts, and the streamed log.
 * Presentational — every value comes from the job in the provider, so this shows
 * the same thing whether the run started a second ago or ten minutes before the
 * dialog was reopened.
 */
export function JobLog({
  job,
  onAbort,
  onSignIn,
}: {
  job: GenerateJob;
  onAbort: () => void;
  onSignIn: () => void;
}) {
  const { now } = useGenerateJobs();
  const logRef = useRef<HTMLDivElement | null>(null);
  const running = job.status === "running";

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [job.log.length]);

  // Terminal semantics: Ctrl+C aborts. Text selection wins — if the user is
  // copying from the log, let the browser copy instead of killing the job.
  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
        e.preventDefault();
        onAbort();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, onAbort]);

  const elapsed = Math.max(0, Math.floor((now - job.startedAt) / 1000));
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  // Seconds since the last log line. Writing a lesson is one long quiet step, so
  // surface the wait rather than let the panel look hung.
  const idleSec = running ? Math.floor((now - job.lastActivity) / 1000) : 0;

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 font-semibold text-ink">
          {running ? (
            <SpinnerIcon className="h-4 w-4 text-accent" />
          ) : job.status === "done" ? (
            <CheckIcon className="h-4 w-4 text-ok" />
          ) : job.status === "aborted" ? (
            <StopIcon className="h-4 w-4 text-muted" />
          ) : (
            <AlertIcon className="h-4 w-4 text-danger" />
          )}
          {running ? "Running" : job.status === "done" ? "Done" : job.status === "aborted" ? "Stopped" : "Failed"}
          {running && (
            <span data-numeric className="font-normal text-muted">
              {clock}
            </span>
          )}
        </span>
        <span data-numeric className="text-xs text-muted" title="Tokens in / out">
          {job.tokens.input.toLocaleString()} in · {job.tokens.output.toLocaleString()} out
        </span>
      </div>
      <div
        ref={logRef}
        className="h-56 overflow-y-auto rounded-lg bg-cover/70 p-3 font-mono text-xs leading-relaxed text-ink-2"
      >
        {job.log.map((l, i) => (
          // Cap any single line so a stray verbose block can't turn the log into
          // a wall of text.
          <div key={i}>{l.length > 500 ? l.slice(0, 500) + " …" : l}</div>
        ))}
        {running && (
          <div className="animate-pulse pt-1 text-muted">
            {idleSec >= 5 ? `Working · ${idleSec}s since last step` : "Working"}
          </div>
        )}
      </div>

      {job.status === "error" && (
        <p className="mt-3 text-sm text-danger">
          {job.needsAuth ? "Claude Code isn't signed in. Nothing was saved." : "Failed. Nothing was saved. The log shows why."}
        </p>
      )}
      {job.needsAuth && (
        <button onClick={onSignIn} className="ui-btn ui-btn-sm ui-btn-primary mt-2 w-full">
          Sign in to Claude Code
        </button>
      )}
    </>
  );
}
