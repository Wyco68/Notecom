"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LAYOUTS, layoutLabel, pageLimitText, sheetDocument, type SheetMeta } from "@/lib/sheet/layout";
import { auditLayout, describeIssue, paginate, type LayoutIssue } from "@/lib/sheet/paginate";
import SpinnerIcon from "../icons/SpinnerIcon";
import { useGenerateJobs, type GenerateJob } from "../generate/GenerateJobsProvider";
import { useToast } from "../toast/ToastProvider";

// A stored cheatsheet: its pages, its checks, and a chat box to change it.
//
// The sheet renders in a sandboxed iframe with no scripts of its own — the
// HTML came from a model, and the contract check is not the only thing that
// should stand between it and the app's origin. This component reaches in
// (allow-same-origin) to deal the blocks into pages, measure and audit them.
//
// The chat box is how a sheet changes after it is made. A message starts an
// edit run (lib/generate/runner.ts): the new version goes through every check
// and the independent review, and is saved over this one with both turns
// added to the conversation, which lives with the sheet (notes_documents.meta).
// One edit at a time per sheet, so two versions never race to be saved.

type Fit = { pages: number; font: number; issues: LayoutIssue[] };
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
  const { jobs, editSheet, abort, dismiss } = useGenerateJobs();
  const toast = useToast();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState<Fit | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 1147, height: 800 });
  const [scale, setScale] = useState(1);
  const [saving, setSaving] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // This sheet's edit runs. A finished one is already saved and in the
  // conversation; the rest are shown as turns in progress or failed.
  const edits = jobs.filter((j) => j.kind === "sheet" && j.folder === folder && j.edit?.docKey === id);
  const live = edits.filter((j) => j.status !== "done");
  const running = live.find((j) => j.status === "running") ?? null;
  const savedCount = edits.filter((j) => j.status === "done").length;

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
    // savedCount: an edit just landed — show the new version.
  }, [folder, id, savedCount]);

  const spec = doc?.meta?.spec ?? null;
  const srcDoc = useMemo(
    () => (doc && spec ? sheetDocument(doc.html, spec.layout, doc.title, spec.columns) : ""),
    [doc, spec]
  );

  const layOut = useCallback(async () => {
    const d = frameRef.current?.contentDocument;
    if (!d || !spec) return;
    await d.fonts?.ready;
    const L = LAYOUTS[spec.layout];
    const numbered = spec.layout === "roomy";
    let font = L.font;
    let pages = paginate(d, font, numbered);
    // No page limit (0): the sheet keeps the layout's own font.
    while (spec.pages && pages > spec.pages && font - 0.25 >= L.minFont - 1e-6) {
      font = Math.round((font - 0.25) * 100) / 100;
      pages = paginate(d, font, numbered);
    }
    setFit({ pages, font, issues: auditLayout(d) });
    setFrameSize({ width: d.documentElement.scrollWidth, height: d.documentElement.scrollHeight });
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
        body: JSON.stringify({ pages, font: fit.font }),
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

  const over = !!fit && !!spec && spec.pages > 0 && fit.pages > spec.pages;
  const review = doc?.meta?.review ?? null;
  const reviewOpen = review?.open ?? [];
  const checks: Array<{ ok: boolean; label: string; detail?: string[] }> =
    fit && spec
      ? [
          { ok: true, label: "Tags, wording and every chapter present" },
          {
            ok: !!review && review.passes > 0 && !reviewOpen.length,
            label: review?.passes
              ? `Checked against the sources by an independent review (${review.passes} ${review.passes === 1 ? "pass" : "passes"}, ${review.found} ${review.found === 1 ? "problem" : "problems"} fixed${reviewOpen.length ? `, ${reviewOpen.length} open` : ""})`
              : "Checked against the sources by an independent review",
            detail: reviewOpen,
          },
          {
            ok: !over,
            label: !spec.pages
              ? `No page limit: ${pageLimitText(fit.pages).replace("no page limit", "")} at ${fit.font}pt`
              : over
                ? `Page limit: ${fit.pages} pages at the smallest font (${fit.font}pt), limit ${spec.pages}`
                : `Page limit: ${fit.pages} of ${spec.pages} at ${fit.font}pt`,
          },
          {
            ok: !fit.issues.length,
            label: fit.issues.length
              ? `Layout: ${fit.issues.length} ${fit.issues.length === 1 ? "problem" : "problems"}`
              : "Layout: every block inside its column, no overlaps, nothing cut off, no stranded headings",
            detail: fit.issues.slice(0, 12).map(describeIssue),
          },
        ]
      : [];
  const allPass = checks.length > 0 && checks.every((c) => c.ok);

  // What the failed checks ask for, as a message the reader can see sent.
  function fixMessage(): string {
    const parts: string[] = [];
    if (over && fit && spec) {
      const cut = Math.min(60, Math.ceil((1 - spec.pages / fit.pages) * 100) + 5);
      parts.push(
        `It prints on ${fit.pages} pages at the smallest font and the limit is ${spec.pages}: cut about ${cut}% of the text, keeping every fact.`
      );
    }
    if (fit?.issues.length) {
      parts.push(`Fix these layout problems: ${fit.issues.slice(0, 12).map(describeIssue).join("; ")}.`);
    }
    return parts.join(" ");
  }

  async function send(message: string): Promise<boolean> {
    return !!(await editSheet({ folder, id, message }));
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-label="Cheatsheet" className="min-w-0">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{doc?.title ?? "Cheatsheet"}</h1>
            {spec && (
              <p className="mt-0.5 text-sm text-gray-500">
                {folderName} · chapters {spec.from}–{spec.to} · {layoutLabel(spec.layout, spec.columns)}
                {fit && (
                  <span data-numeric className={`ui-badge ml-2 ${allPass ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                    {spec.pages
                      ? `${fit.pages} / ${pageLimitText(spec.pages)}`
                      : `${pageLimitText(fit.pages)}, no limit`}
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={print} disabled={!fit} className="ui-btn ui-btn-xs ui-btn-secondary">
              Print…
            </button>
            <button
              onClick={savePdf}
              disabled={!fit || saving}
              title={allPass ? "Save to your Downloads folder" : "Some checks have not passed"}
              className={`ui-btn ui-btn-xs ${allPass ? "ui-btn-primary" : "ui-btn-secondary"}`}
            >
              {saving ? "Saving…" : allPass ? "Save PDF" : "Save PDF anyway"}
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
            {checks.length > 0 && (
              <section aria-label="Checks" className="ui-card mb-3 px-3 py-2.5 text-xs">
                <ul className="space-y-1">
                  {checks.map((c) => (
                    <li key={c.label}>
                      <div className="flex gap-2">
                        <span
                          aria-hidden="true"
                          className={c.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}
                        >
                          {c.ok ? "✓" : "!"}
                        </span>
                        <span className="text-gray-700 dark:text-gray-300">
                          <span className="sr-only">{c.ok ? "Passed: " : "Not passed: "}</span>
                          {c.label}
                        </span>
                      </div>
                      {!!c.detail?.length && (
                        <ul className="ml-5 mt-0.5 list-disc space-y-0.5 pl-3 text-gray-500 dark:text-gray-400">
                          {c.detail.map((d, i) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
                {fit && (over || fit.issues.length > 0) && (
                  <button
                    onClick={() => send(fixMessage())}
                    disabled={!!running}
                    className="ui-btn ui-btn-xs ui-btn-secondary mt-2.5"
                  >
                    Ask Claude to fix these
                  </button>
                )}
              </section>
            )}
            <div
              ref={boxRef}
              className="overflow-hidden rounded-md border border-black/10 bg-[#d9dce1] dark:border-white/10"
              style={{ height: frameSize.height * scale }}
            >
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
        messages={doc?.meta?.messages ?? []}
        live={live}
        busy={!!running}
        disabled={!doc || !spec}
        onSend={send}
        onStop={(jobId) => abort(jobId)}
        onDismiss={(jobId) => dismiss(jobId)}
        onShowLog={onShowLog}
      />
    </div>
  );
}

/**
 * The conversation beside the sheet: what the reader asked, what Claude said
 * it changed, and any edit still running or failed. Enter sends, Shift+Enter
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

  return (
    <aside
      aria-label="Edit the cheatsheet"
      className="flex min-h-[24rem] flex-col rounded-lg border border-black/10 bg-white dark:border-white/10 dark:bg-[#161b22] lg:sticky lg:top-16 lg:h-[calc(100dvh-6rem)]"
    >
      <div className="border-b border-black/10 px-3 py-2 dark:border-white/10">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Edit with Claude</h2>
        <p className="text-xs text-gray-500">Ask for a change. Each version is checked against the notes again.</p>
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
          const running = j.status === "running";
          const secs = Math.max(0, Math.floor((now - j.startedAt) / 1000));
          return (
            <div key={j.id} className="space-y-3">
              <Bubble role="user" text={j.edit?.request ?? ""} />
              <div
                className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                  running
                    ? "bg-black/[0.03] text-gray-600 dark:bg-white/[0.04] dark:text-gray-400"
                    : "border border-red-500/30 bg-red-500/[0.06] text-red-700 dark:text-red-300"
                }`}
              >
                {running ? (
                  <div className="flex items-start gap-2">
                    <SpinnerIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                    <span className="min-w-0 flex-1 break-words">
                      {status(j)}{" "}
                      <span data-numeric className="text-gray-400">
                        {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
                      </span>
                    </span>
                  </div>
                ) : (
                  <p>
                    {j.status === "aborted" ? "Stopped." : "That edit didn't go through."} The sheet is unchanged.{" "}
                    <span className="text-gray-500">{j.status === "error" ? status(j) : ""}</span>
                  </p>
                )}
                <div className="mt-1.5 flex gap-3">
                  <button onClick={() => onShowLog(j.id)} className="underline-offset-2 hover:underline">
                    Log
                  </button>
                  {running ? (
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
            placeholder={busy ? "Claude is working on the last change…" : "Ask for a change…"}
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
