"use client";

import { useGenerateJobs } from "./GenerateJobsProvider";
import SpinnerIcon from "../icons/SpinnerIcon";

// Live generation runs, in the sidebar.
//
// This is what makes a background job visible: once the dialog is closed, this
// row is the only sign a lesson is still being written, and the way back to its
// log. Collapsed to nothing when there is no run to report, like the two
// inboxes above it.
export default function GenerateJobList({
  onOpen,
  folderNames,
}: {
  onOpen: (jobId: string) => void;
  /** slug -> display name, so a renamed folder shows its current name here too. */
  folderNames?: Record<string, string>;
}) {
  const { jobs, now, abort, dismiss } = useGenerateJobs();
  if (!jobs.length) return null;

  return (
    <div className="border-b border-black/10 px-2 py-2 dark:border-white/10">
      <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
        Generating
      </p>
      {jobs.map((job, i) => {
        const running = job.status === "running";
        const elapsed = Math.max(0, Math.floor((now - job.startedAt) / 1000));
        const clock = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(
          elapsed % 60
        ).padStart(2, "0")}`;
        const folderLabel = folderNames?.[job.folder] ?? job.folder.replace(/-/g, " ");
        return (
          <div
            key={job.id}
            style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}
            className="ui-rise group flex items-center"
          >
            <button
              onClick={() => onOpen(job.id)}
              title={`${job.kind === "quiz" ? "Quiz" : "Lesson"} in ${folderLabel} — open the log`}
              className="ui-row flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-sm"
            >
              {running ? (
                <SpinnerIcon className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
              ) : (
                <span
                  className={`shrink-0 text-xs ${
                    job.status === "done"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : job.status === "aborted"
                        ? "text-gray-500"
                        : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {job.status === "done" ? "✓" : job.status === "aborted" ? "^C" : "✗"}
                </span>
              )}
              {/* One line always: this row has a fixed height budget, so a long
                  folder name clips and the title attribute carries the rest. */}
              <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">
                {folderLabel}
              </span>
              {running && (
                <span className="shrink-0 font-mono text-xs tabular-nums text-gray-500">
                  {clock}
                </span>
              )}
            </button>
            {running ? (
              <button
                onClick={() => abort(job.id)}
                title="Abort this run"
                aria-label={`Abort generating in ${folderLabel}`}
                className="ui-icon-btn ui-icon-btn-danger ui-reveal mr-1 h-5 w-5 text-xs"
              >
                ✕
              </button>
            ) : (
              <button
                onClick={() => dismiss(job.id)}
                title="Dismiss"
                aria-label={`Dismiss the finished run in ${folderLabel}`}
                className="ui-icon-btn ui-reveal mr-1 h-5 w-5 text-xs"
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
