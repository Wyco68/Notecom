"use client";

import { useEffect, useRef, useState } from "react";
import type { Folder } from "@/lib/vault/types";
import Modal from "./Modal";
import {
  MAX_CONCURRENT_JOBS,
  useGenerateJobs,
  type GenerateJob,
} from "../generate/GenerateJobsProvider";

// Start a generation run, and watch one.
//
// The dialog does not own the run — GenerateJobsProvider does. That is what
// makes generation a background job: closing this returns the reader to their
// notes while the log keeps filling, the sidebar keeps a live row, and the tree
// refreshes itself when the file lands. Reopening from that row lands back here
// on the same job.
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
  const [folder, setFolder] = useState(folders[0]?.name ?? "");
  const [kind, setKind] = useState<"lect" | "quiz">("lect");
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
      const id = await start({ file, folder, kind });
      if (id) setWatching(id);
    } finally {
      setStarting(false);
    }
  }

  // A job that finished and was dismissed from the sidebar takes its row with
  // it; there is nothing left to show, so close rather than sit on a blank panel.
  useEffect(() => {
    if (watching && !job) onClose();
  }, [watching, job, onClose]);

  if (job) {
    return (
      <Modal title="Generate from file" onClose={onClose}>
        <JobLog job={job} onAbort={() => abort(job.id)} onSignIn={onSignIn} />
        <div className="mt-3 flex gap-2">
          <button onClick={onClose} className="ui-btn ui-btn-sm ui-btn-secondary flex-1">
            {job.status === "running" ? "Run in background" : "Close"}
          </button>
          {job.status === "running" && (
            <button
              onClick={() => abort(job.id)}
              className="ui-btn ui-btn-sm ui-btn-danger-outline shrink-0"
            >
              Abort
            </button>
          )}
        </div>
        {job.status === "running" && (
          <p className="mt-2 text-center text-xs leading-snug text-gray-500">
            Closing this keeps the run going — follow it from the sidebar.
          </p>
        )}
      </Modal>
    );
  }

  return (
    <Modal title="Generate from file" onClose={onClose}>
      <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
        Subject
      </label>
      <select
        value={folder}
        onChange={(e) => setFolder(e.target.value)}
        className="ui-field mb-4"
      >
        {folders.map((f) => (
          <option key={f.name} value={f.name}>
            {f.name.replace(/-/g, " ")}
          </option>
        ))}
      </select>

      <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
        Type
      </label>
      <div className="mb-4 flex gap-2">
        {(["lect", "quiz"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`ui-btn flex-1 border transition-transform duration-150 ease-out active:scale-[0.98] ${
              kind === k
                ? "border-blue-600/50 bg-blue-600/10 text-blue-700 dark:bg-blue-600/20 dark:text-blue-300"
                : "ui-btn-secondary font-normal"
            }`}
          >
            {k === "lect" ? "Lesson" : "Quiz"}
          </button>
        ))}
      </div>

      <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
        Lecture file (PDF, slides, image, markdown)
      </label>
      <input
        type="file"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="ui-focus mb-5 w-full rounded-md text-sm text-gray-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white file:transition-colors hover:file:bg-blue-500 dark:text-gray-400"
      />

      <button
        onClick={begin}
        disabled={!file || !folder || starting || atCapacity}
        className="ui-btn ui-btn-primary w-full"
      >
        {starting ? "Starting..." : "Generate with Claude Code"}
      </button>
      <p className="mt-2.5 text-xs leading-snug text-gray-500">
        {atCapacity
          ? `Already generating ${activeCount} files — wait for one to finish.`
          : `Runs your local Claude Code CLI on your existing subscription — same as /${kind} in a terminal. Takes a few minutes, and runs in the background so you can keep reading.`}
      </p>
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
  const statusLine = running
    ? `● running ${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`
    : job.status === "done"
      ? "✓ finished"
      : job.status === "aborted"
        ? "^C aborted"
        : "✗ failed";

  // Seconds since the last log line. Writing a lesson is one long quiet step, so
  // surface the wait rather than let the panel look hung.
  const idleSec = running ? Math.floor((now - job.lastActivity) / 1000) : 0;

  return (
    <>
      <div className="mb-2 flex items-center justify-between font-mono text-xs text-emerald-600 dark:text-emerald-400">
        <span>{statusLine}</span>
        <span>
          tokens in {job.tokens.input.toLocaleString()} · out{" "}
          {job.tokens.output.toLocaleString()}
        </span>
      </div>
      <div
        ref={logRef}
        className="h-56 overflow-y-auto rounded-md border border-black/10 bg-[#0a0e14] p-3 font-mono text-xs leading-relaxed text-emerald-400 dark:border-white/10"
      >
        {job.log.map((l, i) => (
          // Cap any single line so a stray verbose block can't turn the log into
          // a wall of text (the model's closing summary is also discouraged in
          // the prompt).
          <div key={i}>{l.length > 500 ? l.slice(0, 500) + " …" : l}</div>
        ))}
        {running && (
          <div className="flex items-center gap-1 pt-1 text-emerald-400">
            <span>generating</span>
            <span className="inline-flex gap-0.5">
              <span className="animate-pulse [animation-delay:0ms]">.</span>
              <span className="animate-pulse [animation-delay:200ms]">.</span>
              <span className="animate-pulse [animation-delay:400ms]">.</span>
            </span>
            {idleSec >= 5 && (
              <span className="text-emerald-600/70">
                (still working — {idleSec}s since last step)
              </span>
            )}
          </div>
        )}
      </div>

      {job.status === "error" && (
        <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-xs leading-relaxed text-red-700 dark:text-red-300">
          {job.needsAuth
            ? "Claude Code isn't signed in — nothing was saved. Sign in, then generate again."
            : "Generation failed — nothing was saved. See the log above for the reason; if it was a network or usage-limit error, just generate again."}
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
