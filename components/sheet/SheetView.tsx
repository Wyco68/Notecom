"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LAYOUTS,
  layoutLabel,
  pageLimitText,
  reviewOf,
  sheetDocument,
  type SheetMeta,
  type SourceRef,
} from "@/lib/sheet/layout";
import { describeIssue } from "@/lib/sheet/paginate";
import { fitSheet, type Fit } from "@/lib/sheet/fit";
import type { Lesson } from "@/lib/vault/types";
import SpinnerIcon from "../icons/SpinnerIcon";
import Modal from "../modals/Modal";
import { useGenerateJobs, type GenerateJob } from "../generate/GenerateJobsProvider";
import { useToast } from "../toast/ToastProvider";

// A stored cheatsheet: its pages, the steps that made and checked it, and a
// chat box to change it.
//
// The sheet renders in a sandboxed iframe with no scripts of its own — the
// HTML came from a model, and the contract check is not the only thing that
// should stand between it and the app's origin. This component reaches in
// (allow-same-origin) to lay the blocks into pages, fit and audit them.
//
// Every step is the reader's to start, and every step saves as it goes
// (lib/generate/sheet.ts), so a run that runs out of tokens never costs what
// was already done: "Continue writing" finishes a sheet whose chapters
// stopped part-way, "Run review" checks the chapters not yet checked, and the
// fix buttons send what the checks found to Claude as a chat message. One step
// at a time per sheet. Save PDF works from the first saved chapter on.

type Doc = { html: string; title: string; meta: SheetMeta | null };

export default function SheetView({
  folder,
  id,
  folderName,
  onShowLog,
}: {
  folder: string;
  id: string;
  folderName: string;
  /** open a run's full log (the cheatsheet dialog) */
  onShowLog: (jobId: string) => void;
}) {
  const { jobs, sheetStep, abort, dismiss } = useGenerateJobs();
  const toast = useToast();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState<Fit | null>(null);
  const [fitting, setFitting] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 818, height: 800 });
  const [scale, setScale] = useState(1);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // This sheet's steps. A finished one is saved and in the conversation; a
  // running or failed one is shown as a turn in progress.
  const steps = jobs.filter((j) => j.kind === "sheet" && j.folder === folder && j.edit?.docKey === id);
  const live = steps.filter((j) => j.status !== "done");
  const running = live.find((j) => j.status === "running") ?? null;
  const saves = steps.reduce((n, j) => n + (j.saves ?? 0), 0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(`/api/sheets/${encodeURIComponent(folder)}/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "could not load the cheatsheet");
        if (cancelled) return;
        const spec = (data.meta as SheetMeta | null)?.spec;
        if (spec) setFrameSize({ width: Math.ceil((LAYOUTS[spec.layout].width * 96) / 25.4) + 24, height: 800 });
        setFit(null);
        setDoc({ html: data.html, title: data.title, meta: data.meta ?? null });
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
    // saves: a step just saved part of its work — show it.
  }, [folder, id, saves]);

  const meta = doc?.meta ?? null;
  const spec = meta?.spec ?? null;
  const srcDoc = useMemo(() => (doc && spec ? sheetDocument(doc.html, spec.layout, doc.title) : ""), [doc, spec]);

  const layOut = useCallback(async () => {
    const d = frameRef.current?.contentDocument;
    if (!d || !spec) return;
    await d.fonts?.ready;
    setFitting(spec.pages ? "Fitting the pages…" : "Laying out…");
    try {
      const result = await fitSheet(d, spec, setFitting);
      setFit(result);
      setFrameSize({ width: d.documentElement.scrollWidth, height: d.documentElement.scrollHeight });
    } finally {
      setFitting(null);
    }
  }, [spec]);

  // The pages are a fixed A4 width; the column is not. Scale the preview down
  // to fit rather than scroll it sideways.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const update = () => setScale(Math.min(1, box.clientWidth / frameSize.width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(box);
    return () => ro.disconnect();
  }, [frameSize.width, doc]);

  function print() {
    frameRef.current?.contentWindow?.print();
  }

  // One click to a PDF in Downloads: the server prints exactly these pages
  // with a browser already on the machine. Without one, the print dialog is
  // the way, and the reader is told to pick "Save as PDF" there.
  async function savePdf() {
    const pages = frameRef.current?.contentDocument?.getElementById("pages")?.innerHTML;
    if (!pages || !fit || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sheets/${encodeURIComponent(folder)}/${encodeURIComponent(id)}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages, font: fit.font, columns: fit.columns }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) toast.success(`Saved ${data.path}`);
      else if (data.fallback === "print") {
        toast.error(`${data.error}. Opening the print dialog — choose "Save as PDF" there.`);
        print();
      } else toast.error(data.error || "Saving the PDF failed.");
    } catch {
      toast.error("Couldn't reach the app server to save the PDF.");
    } finally {
      setSaving(false);
    }
  }

  const step = (
    action: "edit" | "continue" | "review" | "sources",
    body?: Record<string, unknown> | FormData,
    request?: string
  ) => sheetStep({ folder, id, action, body, request });

  // --- what the steps say --------------------------------------------------------
  const chapters = spec ? spec.to - spec.from + 1 : 0;
  const pending = meta?.pending ?? [];
  const written = chapters - pending.length;
  const review = reviewOf(meta);
  const findings = Object.entries(review.issues).flatMap(([seq, list]) => list.map((t) => `chapter ${seq}: ${t}`));
  const checks = meta?.checks ?? [];
  const over = !!fit && !!spec && spec.pages > 0 && fit.pages > spec.pages;
  const layoutIssues = fit?.issues.map(describeIssue) ?? [];
  const busy = !!running || !!fitting;
  const allPass =
    !!fit &&
    !pending.length &&
    !checks.length &&
    !over &&
    !layoutIssues.length &&
    review.reviewed.length >= chapters &&
    !findings.length;

  function fixChecksMessage(): string {
    const parts: string[] = [];
    if (checks.length) parts.push(`Fix what the app's checks found: ${checks.join("; ")}.`);
    if (over && fit && spec) {
      const cut = Math.min(60, Math.ceil((1 - spec.pages / fit.pages) * 100) + 5);
      parts.push(
        `It needs ${fit.pages} pages at the smallest font and the limit is ${spec.pages}: cut about ${cut}% of the text, keeping every fact.`
      );
    }
    if (layoutIssues.length) parts.push(`Fix these layout problems: ${layoutIssues.slice(0, 12).join("; ")}.`);
    return parts.join(" ");
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-label="Cheatsheet" className="min-w-0">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{doc?.title ?? "Cheatsheet"}</h1>
            {spec && (
              <p className="mt-0.5 text-sm text-gray-500">
                {folderName} · chapters {spec.from}–{spec.to} · {layoutLabel(spec, fit?.columns)}
                {fit && <> · {fit.font}pt</>}
                {fit && (
                  <span
                    data-numeric
                    className={`ui-badge ml-2 ${allPass ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}
                  >
                    {spec.pages ? `${fit.pages} / ${pageLimitText(spec.pages)}` : `${pageLimitText(fit.pages)}, no limit`}
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={print} disabled={!fit || !!fitting} className="ui-btn ui-btn-xs ui-btn-secondary">
              Print…
            </button>
            <button
              onClick={savePdf}
              disabled={!fit || !!fitting || saving}
              title={allPass ? "Save to your Downloads folder" : "Saves the sheet as it is now"}
              className="ui-btn ui-btn-xs ui-btn-primary"
            >
              {saving ? "Saving…" : "Save PDF"}
            </button>
          </div>
        </div>

        {error ? (
          <p className="ui-empty">{error}</p>
        ) : !doc ? (
          <p className="ui-empty flex items-center gap-2">
            <SpinnerIcon className="h-3.5 w-3.5" /> Loading the cheatsheet…
          </p>
        ) : !spec ? (
          <p className="ui-empty">This cheatsheet has no layout information, so it can't be shown.</p>
        ) : (
          <>
            <section aria-label="Steps" className="ui-card mb-3 divide-y divide-black/5 text-xs dark:divide-white/5">
              <StepRow
                ok={!pending.length}
                title={pending.length ? `Written: ${written} of ${chapters} chapters` : `Written: all ${chapters} chapters`}
                detail={pending.length ? [`still to write: chapter${pending.length > 1 ? "s" : ""} ${pending.join(", ")}`] : []}
                action={
                  pending.length ? (
                    <button onClick={() => step("continue")} disabled={busy} className="ui-btn ui-btn-xs ui-btn-primary">
                      Continue writing
                    </button>
                  ) : null
                }
              />
              <StepRow
                ok={!!fit && !checks.length && !over && !layoutIssues.length}
                title={
                  !fit
                    ? "Checks: laying out…"
                    : checks.length || over || layoutIssues.length
                      ? `Checks: ${checks.length + layoutIssues.length + (over ? 1 : 0)} to fix`
                      : `Checks: wording, numbers, length and layout all pass${spec.pages ? ` · fills ${pageLimitText(fit.pages)} at ${fit.font}pt in ${fit.columns} columns` : ""}`
                }
                detail={[
                  ...checks,
                  ...(over && fit ? [`needs ${fit.pages} pages at the smallest font; the limit is ${spec.pages}`] : []),
                  ...layoutIssues.slice(0, 12),
                ]}
                action={
                  checks.length || over || layoutIssues.length ? (
                    <button
                      onClick={() => step("edit", { message: fixChecksMessage() }, fixChecksMessage())}
                      disabled={busy}
                      className="ui-btn ui-btn-xs ui-btn-secondary"
                    >
                      Fix these
                    </button>
                  ) : null
                }
              />
              <StepRow
                ok={review.reviewed.length >= chapters && !findings.length}
                title={
                  review.reviewed.length
                    ? `Review against the sources: ${review.reviewed.length} of ${chapters} chapters checked${findings.length ? `, ${findings.length} finding${findings.length > 1 ? "s" : ""}` : ""}`
                    : "Review against the sources: not run yet"
                }
                detail={findings.slice(0, 20)}
                action={
                  <div className="flex gap-1.5">
                    {review.reviewed.length < chapters ? (
                      <button
                        onClick={() => step("review")}
                        disabled={busy || pending.length > 0}
                        title={pending.length ? "Finish writing first" : undefined}
                        className="ui-btn ui-btn-xs ui-btn-primary"
                      >
                        {review.reviewed.length ? "Continue review" : "Run review"}
                      </button>
                    ) : (
                      <button onClick={() => step("review", { all: true })} disabled={busy} className="ui-btn ui-btn-xs ui-btn-ghost">
                        Review again
                      </button>
                    )}
                    {findings.length > 0 && (
                      <button
                        onClick={() => {
                          const message = `A reviewer compared the sheet with the sources and found these problems. Fix every one against the sources: correct what is wrong, remove what the sources do not say, add what is missing. ${findings.join("; ")}`;
                          step("edit", { message }, `Fix the ${findings.length} review finding(s).`);
                        }}
                        disabled={busy}
                        className="ui-btn ui-btn-xs ui-btn-secondary"
                      >
                        Fix findings
                      </button>
                    )}
                  </div>
                }
              />
              <StepRow
                ok
                title={
                  spec.extra?.length
                    ? `Sources: chapters ${spec.from}–${spec.to} + ${spec.extra.map((r) => r.title).join(", ")}`
                    : `Sources: chapters ${spec.from}–${spec.to}`
                }
                action={
                  <button onClick={() => setAdding(true)} disabled={busy} className="ui-btn ui-btn-xs ui-btn-ghost">
                    Add sources
                  </button>
                }
              />
            </section>

            <div
              ref={boxRef}
              className="relative overflow-hidden rounded-md border border-black/10 bg-[#d9dce1] dark:border-white/10"
              style={{ height: frameSize.height * scale }}
            >
              {fitting && (
                <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-2 bg-white/80 py-2 text-xs text-gray-600 dark:bg-black/60 dark:text-gray-300">
                  <SpinnerIcon className="h-3.5 w-3.5" /> {fitting}
                </div>
              )}
              {srcDoc && (
                <iframe
                  ref={frameRef}
                  title="Cheatsheet preview"
                  srcDoc={srcDoc}
                  sandbox="allow-same-origin allow-modals"
                  onLoad={layOut}
                  style={{
                    width: frameSize.width,
                    height: frameSize.height,
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                    border: 0,
                    display: "block",
                  }}
                />
              )}
            </div>
          </>
        )}
      </section>

      <SheetChat
        messages={meta?.messages ?? []}
        live={live}
        busy={busy}
        disabled={!doc || !spec}
        onSend={async (message) => !!(await step("edit", { message }, message))}
        onStop={(jobId) => abort(jobId)}
        onDismiss={(jobId) => dismiss(jobId)}
        onShowLog={onShowLog}
      />

      {adding && spec && (
        <AddSourcesModal
          folder={folder}
          range={{ from: spec.from, to: spec.to }}
          kept={spec.extra ?? []}
          onClose={() => setAdding(false)}
          onSubmit={async (form, label) => {
            const ok = !!(await step("sources", form, label));
            if (ok) setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function StepRow({
  ok,
  title,
  detail = [],
  action,
}: {
  ok: boolean;
  title: string;
  detail?: string[];
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2">
      <span aria-hidden="true" className={`mt-px ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
        {ok ? "✓" : "!"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-gray-700 dark:text-gray-300">
          <span className="sr-only">{ok ? "Done: " : "To do: "}</span>
          {title}
        </p>
        {detail.length > 0 && (
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-gray-500 dark:text-gray-400">
            {detail.map((d, i) => (
              <li key={i} className="break-words">
                {d}
              </li>
            ))}
          </ul>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * New sources for an existing sheet: the folder's quizzes and lessons outside
 * the sheet's range, and uploaded files. Picked documents stay with the sheet;
 * uploads are read for this change only.
 */
function AddSourcesModal({
  folder,
  range,
  kept,
  onClose,
  onSubmit,
}: {
  folder: string;
  range: { from: number; to: number };
  kept: SourceRef[];
  onClose: () => void;
  onSubmit: (form: FormData, label: string) => Promise<void>;
}) {
  const [docs, setDocs] = useState<{ lessons: Lesson[]; quizzes: Lesson[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch(`/api/folders/${encodeURIComponent(folder)}`)
      .then((r) => (r.ok ? r.json() : { lessons: [], quizzes: [] }))
      .then((d) => setDocs({ lessons: d.lessons ?? [], quizzes: d.quizzes ?? [] }))
      .catch(() => setDocs({ lessons: [], quizzes: [] }));
  }, [folder]);

  const has = (kind: string, docId: string) => kept.some((k) => k.kind === kind && k.id === docId);
  const options = docs
    ? [
        ...docs.quizzes.map((q) => ({ kind: "quiz" as const, doc: q })),
        ...docs.lessons
          .filter((l) => l.seq < range.from || l.seq > range.to)
          .map((l) => ({ kind: "lesson" as const, doc: l })),
      ]
    : [];
  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  async function submit() {
    if (sending || (!picked.size && !files.length)) return;
    setSending(true);
    try {
      const refs = [...picked].map((k) => {
        const [kind, ...rest] = k.split(":");
        return { kind, id: rest.join(":") };
      });
      const form = new FormData();
      form.set("refs", JSON.stringify(refs));
      for (const f of files) form.append("files", f);
      if (note.trim()) form.set("note", note.trim());
      const names = [
        ...options.filter((o) => picked.has(`${o.kind}:${o.doc.id}`)).map((o) => o.doc.title),
        ...files.map((f) => f.name),
      ];
      await onSubmit(form, `Add sources: ${names.join(", ")}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title="Add sources" onClose={onClose}>
      <p className="mb-3 text-xs leading-snug text-gray-500">
        Claude adds what these say to the chapters they belong to; the new version is checked like any other. Picked
        documents stay with the sheet for later edits and reviews; uploaded files are used for this change only.
      </p>
      {!docs ? (
        <p className="ui-empty mb-3">Loading the folder…</p>
      ) : !options.length ? (
        <p className="ui-empty mb-3">No quizzes or other lessons in this folder.</p>
      ) : (
        <fieldset className="ui-scroll mb-3 max-h-56 space-y-1 overflow-y-auto">
          <legend className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">From this folder</legend>
          {options.map((o) => {
            const key = `${o.kind}:${o.doc.id}`;
            const already = has(o.kind, o.doc.id);
            return (
              <label key={key} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  className="ui-focus mt-0.5"
                  checked={already || picked.has(key)}
                  disabled={already}
                  onChange={() => toggle(key)}
                />
                <span className="min-w-0 break-words">
                  <span className="text-xs text-gray-500">
                    {o.kind === "quiz" ? "Quiz" : `Lesson ${String(o.doc.seq).padStart(2, "0")}`}
                  </span>{" "}
                  {o.doc.title}
                  {already && <span className="text-xs text-gray-500"> · already a source</span>}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
      <label htmlFor="sources-files" className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
        Files (slides, handouts — optional)
      </label>
      <input
        id="sources-files"
        type="file"
        multiple
        onChange={(e) => setFiles([...(e.target.files ?? [])])}
        className="ui-focus mb-3 w-full rounded-md text-sm text-gray-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white file:transition-colors hover:file:bg-blue-500 dark:text-gray-400"
      />
      <label htmlFor="sources-note" className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
        Anything Claude should know (optional)
      </label>
      <textarea
        id="sources-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={2000}
        className="ui-field mb-4 resize-none"
      />
      <div className="flex gap-2">
        <button onClick={onClose} className="ui-btn ui-btn-sm ui-btn-secondary flex-1">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={sending || (!picked.size && !files.length)}
          className="ui-btn ui-btn-sm ui-btn-primary flex-1"
        >
          {sending ? "Starting…" : "Add to the sheet"}
        </button>
      </div>
    </Modal>
  );
}

/**
 * The conversation beside the sheet: what the reader asked, what Claude said
 * it did, and any step still running or failed. Enter sends, Shift+Enter
 * starts a new line.
 */
function SheetChat({
  messages,
  live,
  busy,
  disabled,
  onSend,
  onStop,
  onDismiss,
  onShowLog,
}: {
  messages: SheetMeta["messages"];
  live: GenerateJob[];
  busy: boolean;
  disabled: boolean;
  onSend: (message: string) => Promise<boolean>;
  onStop: (jobId: string) => void;
  onDismiss: (jobId: string) => void;
  onShowLog: (jobId: string) => void;
}) {
  const { now } = useGenerateJobs();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, live.length, live[live.length - 1]?.log.length]);

  async function submit() {
    const text = draft.trim();
    if (!text || busy || sending || disabled) return;
    setSending(true);
    try {
      if (await onSend(text)) setDraft("");
    } finally {
      setSending(false);
    }
  }

  // The last line worth showing from a run's log: skip tool calls and raw JSON.
  const status = (j: GenerateJob) =>
    [...j.log].reverse().find((l) => !l.startsWith("→") && !l.startsWith("{") && l.length < 300) ?? "Starting…";
  const stepName = (j: GenerateJob) =>
    j.step === "write" ? "Writing chapters" : j.step === "review" ? "Reviewing against the sources" : null;

  return (
    <aside
      aria-label="Edit the cheatsheet"
      className="flex min-h-[24rem] flex-col rounded-lg border border-black/10 bg-white dark:border-white/10 dark:bg-[#161b22] lg:sticky lg:top-16 lg:h-[calc(100dvh-6rem)]"
    >
      <div className="border-b border-black/10 px-3 py-2 dark:border-white/10">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Edit with Claude</h2>
        <p className="text-xs text-gray-500">Ask for a change. Every change is saved as soon as it is made.</p>
      </div>

      <div ref={listRef} role="log" aria-live="polite" className="ui-scroll flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        {!messages.length && !live.length && (
          <p className="ui-empty">
            Try “add the OSPF cost formula”, “make chapter 3 shorter” or “turn the port list into a table”.
          </p>
        )}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.text} />
        ))}
        {live.map((j) => {
          const isRunning = j.status === "running";
          const secs = Math.max(0, Math.floor((now - j.startedAt) / 1000));
          const name = stepName(j);
          return (
            <div key={j.id} className="space-y-3">
              {!name && j.edit?.request && <Bubble role="user" text={j.edit.request} />}
              <div
                className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                  isRunning
                    ? "bg-black/[0.03] text-gray-600 dark:bg-white/[0.04] dark:text-gray-400"
                    : "border border-red-500/30 bg-red-500/[0.06] text-red-700 dark:text-red-300"
                }`}
              >
                {isRunning ? (
                  <div className="flex items-start gap-2">
                    <SpinnerIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                    <span className="min-w-0 flex-1 break-words">
                      {name && <b className="font-semibold">{name}: </b>}
                      {status(j)}{" "}
                      <span data-numeric className="text-gray-400">
                        {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
                      </span>
                    </span>
                  </div>
                ) : (
                  <p>
                    {j.status === "aborted" ? "Stopped." : `${name ?? "That change"} didn't finish.`}{" "}
                    {j.saves ? "What it did before stopping is saved." : "Nothing of it was saved."}{" "}
                    <span className="text-gray-500">{j.status === "error" ? status(j) : ""}</span>
                  </p>
                )}
                <div className="mt-1.5 flex gap-3">
                  <button onClick={() => onShowLog(j.id)} className="underline-offset-2 hover:underline">
                    Log
                  </button>
                  {j.status === "running" ? (
                    <button onClick={() => onStop(j.id)} className="underline-offset-2 hover:underline">
                      Stop
                    </button>
                  ) : (
                    <button onClick={() => onDismiss(j.id)} className="underline-offset-2 hover:underline">
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <form
        className="border-t border-black/10 p-2 dark:border-white/10"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="ui-field flex items-end gap-2 px-2 py-1.5">
          <label htmlFor="sheet-chat" className="sr-only">
            Message
          </label>
          <textarea
            id="sheet-chat"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={Math.min(6, Math.max(2, draft.split("\n").length))}
            maxLength={4000}
            disabled={disabled}
            placeholder={busy ? "Wait for the current step to finish…" : "Ask for a change…"}
            className="min-w-0 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-gray-500"
          />
          <button
            type="submit"
            disabled={!draft.trim() || busy || sending || disabled}
            className="ui-btn ui-btn-xs ui-btn-primary shrink-0"
          >
            {sending ? "…" : "Send"}
          </button>
        </div>
      </form>
    </aside>
  );
}

function Bubble({ role, text }: { role: "user" | "assistant"; text: string }) {
  return role === "user" ? (
    <div className="ml-6 whitespace-pre-wrap break-words rounded-lg bg-blue-600/10 px-3 py-2 text-gray-800 dark:bg-blue-600/20 dark:text-gray-100">
      {text}
    </div>
  ) : (
    <div className="mr-6 whitespace-pre-wrap break-words text-gray-700 dark:text-gray-300">{text}</div>
  );
}
