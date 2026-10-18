"use client";

import { useEffect, useState } from "react";
import type { Folder, Lesson } from "@/lib/vault/types";
import { LAYOUTS, MAX_COLUMNS, MAX_PAGES, MIN_COLUMNS, layoutFor } from "@/lib/sheet/layout";
import Modal from "./Modal";
import { JobLog } from "./GenerateModal";
import { MAX_CONCURRENT_JOBS, useGenerateJobs } from "../generate/GenerateJobsProvider";

// Start a cheatsheet run, and watch one.
//
// A cheatsheet is made from lessons already in a folder, so the form asks
// which ones (a first and last chapter) and how many pages it may take; slides
// are optional, for checking the notes against. Like Generate, the run belongs
// to GenerateJobsProvider, so closing this leaves it going. When it is done the
// sheet is saved in the folder and opens in the content column, where it is
// laid out, printed and edited through its chat box.
export default function CheatsheetModal({
  folders,
  onClose,
  onSignIn,
  onOpenSheet,
  watchJobId,
}: {
  folders: Folder[];
  onClose: () => void;
  onSignIn: () => void;
  /** open the saved sheet */
  onOpenSheet: (ref: { folder: string; id: string }) => void;
  watchJobId?: string;
}) {
  const { jobs, activeCount, startSheet, abort } = useGenerateJobs();
  const [folder, setFolder] = useState(folders[0]?.name ?? "");
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  // Kept as typed, so the field can be cleared and retyped; parsed below.
  const [pagesText, setPagesText] = useState("2");
  const [noLimit, setNoLimit] = useState(false);
  // "" = the page size's own column count.
  const [columns, setColumns] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [starting, setStarting] = useState(false);
  const [watching, setWatching] = useState<string | null>(watchJobId ?? null);

  const job = jobs.find((j) => j.id === watching) ?? null;
  const atCapacity = activeCount >= MAX_CONCURRENT_JOBS;

  // The chapter lists follow the chosen folder: its lessons, by number.
  useEffect(() => {
    if (!folder || watching) return;
    let cancelled = false;
    setLessons(null);
    fetch(`/api/folders/${encodeURIComponent(folder)}`)
      .then((r) => (r.ok ? r.json() : { lessons: [] }))
      .then((data) => {
        if (cancelled) return;
        const list: Lesson[] = [...(data.lessons ?? [])].sort((a, b) => a.seq - b.seq);
        setLessons(list);
        setFrom(list[0]?.seq ?? 1);
        setTo(list[list.length - 1]?.seq ?? 1);
      })
      .catch(() => !cancelled && setLessons([]));
    return () => {
      cancelled = true;
    };
  }, [folder, watching]);

  useEffect(() => {
    if (watching && !job) onClose();
  }, [watching, job, onClose]);

  const pagesNum = Number(pagesText);
  const pagesValid = noLimit || (Number.isInteger(pagesNum) && pagesNum >= 1 && pagesNum <= MAX_PAGES);
  // 0 = no page limit.
  const pages = noLimit ? 0 : pagesValid ? pagesNum : 1;

  async function begin() {
    if (!folder || starting || !lessons?.length || from > to || !pagesValid) return;
    setStarting(true);
    try {
      const id = await startSheet({
        folder,
        from,
        to,
        pages,
        columns: noLimit && columns ? Number(columns) : undefined,
        files,
      });
      if (id) setWatching(id);
    } finally {
      setStarting(false);
    }
  }

  if (job) {
    // Saved as soon as its first chapter is: open (and print) it from then on,
    // while the rest is still being written.
    const savedId = job.saved?.id ?? (job.edit?.docKey || undefined);
    const done = !!savedId;
    return (
      <Modal title="Cheatsheet" onClose={onClose}>
        <JobLog job={job} onAbort={() => abort(job.id)} onSignIn={onSignIn} />
        <div className="mt-3 flex gap-2">
          {done ? (
            <button
              onClick={() => onOpenSheet({ folder: job.folder, id: savedId! })}
              className="ui-btn ui-btn-sm ui-btn-primary flex-1"
            >
              Open cheatsheet
            </button>
          ) : (
            <button onClick={onClose} className="ui-btn ui-btn-sm ui-btn-secondary flex-1">
              {job.status === "running" ? "Run in background" : "Close"}
            </button>
          )}
          {job.status === "running" && (
            <button onClick={() => abort(job.id)} className="ui-btn ui-btn-sm ui-btn-danger-outline shrink-0">
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

  const layout = LAYOUTS[layoutFor(pages)];
  const range = lessons?.filter((l) => l.seq >= from && l.seq <= to).length ?? 0;
  const label = "mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400";
  const chapterOptions = (lessons ?? []).map((l) => (
    <option key={l.id} value={l.seq}>
      {String(l.seq).padStart(2, "0")}. {l.title}
    </option>
  ));

  return (
    <Modal title="Cheatsheet" onClose={onClose}>
      <label htmlFor="sheet-folder" className={label}>
        Subject
      </label>
      <select
        id="sheet-folder"
        value={folder}
        onChange={(e) => setFolder(e.target.value)}
        className="ui-field mb-4"
      >
        {folders.map((f) => (
          <option key={f.name} value={f.name}>
            {f.displayName}
          </option>
        ))}
      </select>

      {lessons === null ? (
        <p className="ui-empty mb-4">Loading chapters…</p>
      ) : !lessons.length ? (
        <p className="ui-empty mb-4">This folder has no lessons yet — a cheatsheet is made from its lessons.</p>
      ) : (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="min-w-0">
            <label htmlFor="sheet-from" className={label}>
              From chapter
            </label>
            <select
              id="sheet-from"
              value={from}
              onChange={(e) => {
                const v = Number(e.target.value);
                setFrom(v);
                if (v > to) setTo(v);
              }}
              className="ui-field"
            >
              {chapterOptions}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor="sheet-to" className={label}>
              To chapter
            </label>
            <select
              id="sheet-to"
              value={to}
              onChange={(e) => {
                const v = Number(e.target.value);
                setTo(v);
                if (v < from) setFrom(v);
              }}
              className="ui-field"
            >
              {chapterOptions}
            </select>
          </div>
        </div>
      )}

      <div className="mb-1.5 grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <label htmlFor="sheet-pages" className={label}>
            Page limit
          </label>
          <input
            id="sheet-pages"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_PAGES}
            step={1}
            value={noLimit ? "" : pagesText}
            placeholder={noLimit ? "No limit" : undefined}
            disabled={noLimit}
            onChange={(e) => setPagesText(e.target.value)}
            aria-invalid={!pagesValid}
            aria-describedby="sheet-pages-hint"
            className="ui-field"
          />
        </div>
        {/* A limited sheet's columns and font are fitted to fill its pages
            (lib/sheet/fit.ts); only an unlimited one has columns to choose. */}
        {noLimit && (
          <div className="min-w-0">
            <label htmlFor="sheet-columns" className={label}>
              Columns
            </label>
            <select
              id="sheet-columns"
              value={columns}
              onChange={(e) => setColumns(e.target.value)}
              className="ui-field"
            >
              <option value="">Default ({layout.columns})</option>
              {Array.from({ length: MAX_COLUMNS - MIN_COLUMNS + 1 }, (_, i) => MIN_COLUMNS + i).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <label className="mb-1.5 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
        <input type="checkbox" checked={noLimit} onChange={(e) => setNoLimit(e.target.checked)} className="ui-focus" />
        No page limit — cover everything, as many pages as it takes
      </label>
      <p
        id="sheet-pages-hint"
        className={`mb-4 text-xs ${pagesValid ? "text-gray-500" : "text-red-600 dark:text-red-400"}`}
        data-numeric
      >
        {pagesValid ? (
          <>
            {noLimit
              ? `No page limit · ${layout.label}, ${columns || layout.columns} columns, ${layout.font}pt`
              : `${pages} ${pages === 1 ? "page" : "pages"} · ${layout.label}, columns and font fitted to fill the pages`}
            {range ? ` · ${range} ${range === 1 ? "chapter" : "chapters"}` : ""}
          </>
        ) : (
          `Enter a whole number of pages from 1 to ${MAX_PAGES}, or tick No page limit.`
        )}
      </p>

      <label htmlFor="sheet-files" className={label}>
        Slides to check against (optional)
      </label>
      <input
        id="sheet-files"
        type="file"
        multiple
        onChange={(e) => setFiles([...(e.target.files ?? [])])}
        className="ui-focus mb-5 w-full rounded-md text-sm text-gray-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white file:transition-colors hover:file:bg-blue-500 dark:text-gray-400"
      />

      <button
        onClick={begin}
        disabled={!lessons?.length || from > to || !pagesValid || starting || atCapacity}
        className="ui-btn ui-btn-primary w-full"
      >
        {starting ? "Starting..." : "Make cheatsheet with Claude Code"}
      </button>
      <p className="mt-2.5 text-xs leading-snug text-gray-500">
        {atCapacity
          ? `Already running ${activeCount} jobs — wait for one to finish.`
          : "Runs your local Claude Code CLI on your subscription, like /sheet in a terminal. Takes a few minutes and runs in the background."}
      </p>
    </Modal>
  );
}
