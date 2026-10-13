"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LAYOUTS, sheetDocument, type SheetSpec } from "@/lib/sheet/layout";
import { auditLayout, describeIssue, paginate, type LayoutIssue } from "@/lib/sheet/paginate";
import PanelHeader from "../layout/PanelHeader";
import SpinnerIcon from "../icons/SpinnerIcon";
import { useGenerateJobs } from "../generate/GenerateJobsProvider";
import { useToast } from "../toast/ToastProvider";

// A finished cheatsheet: laid out into pages, fitted to its limit, checked,
// printed.
//
// The sheet renders in a sandboxed iframe with no scripts of its own — the
// HTML came from a model, and the contract check is not the only thing that
// should stand between it and the app's origin. This component reaches in
// (allow-same-origin) to deal the blocks into pages, measure and audit them.
//
// What the reader sees before printing is a list of checks, each passed or
// not: the server's (contract, source check, independent review — see
// generateSheet in lib/generate/runner.ts) and the browser's (page limit,
// layout audit). Fitting the font is free and automatic; anything else that
// fails can be sent back to Claude, which spends tokens, so it is a button.

type Fit = { pages: number; font: number; issues: LayoutIssue[] };
type Review = { passes: number; found: number; open: string[] } | null;

export default function SheetPanel({
  jobId,
  folderName,
  onClose,
  onShowLog,
}: {
  jobId: string;
  folderName: string;
  onClose: () => void;
  onShowLog: () => void;
}) {
  const { jobs, revise } = useGenerateJobs();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const job = jobs.find((j) => j.id === jobId) ?? null;
  const [sheet, setSheet] = useState<{ html: string; sheet: SheetSpec; review: Review } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState<Fit | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 1147, height: 800 });
  const [scale, setScale] = useState(1);
  const [asking, setAsking] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const status = job?.status;
  const round = job?.round ?? 0;
  useEffect(() => {
    if (status !== "done") return;
    let cancelled = false;
    setError(null);
    setFit(null);
    fetch(`/api/sheet/${jobId}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(r.status === 404 ? "gone" : data.error || "could not load the sheet");
        if (cancelled) return;
        // Exactly one page wide (plus the body's padding) until laid out, so
        // the first paint is already at the right scale.
        const L = LAYOUTS[(data.sheet as SheetSpec).layout];
        setFrameSize({ width: Math.ceil((L.width * 96) / 25.4) + 24, height: 800 });
        setSheet({ html: data.html, sheet: data.sheet, review: data.review ?? null });
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [jobId, status, round]);

  const srcDoc = useMemo(
    () => (sheet ? sheetDocument(sheet.html, sheet.sheet.layout, sheet.sheet.title) : ""),
    [sheet]
  );

  const layOut = useCallback(async () => {
    const doc = frameRef.current?.contentDocument;
    if (!doc || !sheet) return;
    await doc.fonts?.ready;
    const L = LAYOUTS[sheet.sheet.layout];
    const numbered = sheet.sheet.layout === "roomy";
    let font = L.font;
    let pages = paginate(doc, font, numbered);
    while (pages > sheet.sheet.pages && font - 0.25 >= L.minFont - 1e-6) {
      font = Math.round((font - 0.25) * 100) / 100;
      pages = paginate(doc, font, numbered);
    }
    setFit({ pages, font, issues: auditLayout(doc) });
    setFrameSize({
      width: doc.documentElement.scrollWidth,
      height: doc.documentElement.scrollHeight,
    });
  }, [sheet]);

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
  }, [frameSize.width, sheet]);

  function print() {
    frameRef.current?.contentWindow?.print();
  }

  // One click to a PDF in Downloads: the server prints exactly these pages
  // with a browser already on the machine. Without one, the print dialog is
  // the way, and the reader is told to pick "Save as PDF" there.
  async function savePdfFile() {
    const pages = frameRef.current?.contentDocument?.getElementById("pages")?.innerHTML;
    if (!pages || !fit || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sheet/${jobId}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages, font: fit.font }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(`Saved ${data.path}`);
      } else if (data.fallback === "print") {
        toast.error(`${data.error}. Opening the print dialog — choose "Save as PDF" there.`);
        print();
      } else {
        toast.error(data.error || "Saving the PDF failed.");
      }
    } catch {
      toast.error("Couldn't reach the app server to save the PDF.");
    } finally {
      setSaving(false);
    }
  }

  const spec = sheet?.sheet ?? job?.sheet;
  const over = !!fit && !!spec && fit.pages > spec.pages;
  const review = sheet?.review ?? null;
  const reviewOpen = review?.open ?? [];

  async function sendBack() {
    if (!fit || asking) return;
    setAsking(true);
    try {
      await revise(jobId, {
        pages: over ? fit.pages : undefined,
        layout: fit.issues.map(describeIssue),
      });
    } finally {
      setAsking(false);
    }
  }

  const checks: Array<{ ok: boolean; label: string; detail?: string[] }> =
    fit && spec
      ? [
          {
            ok: true,
            label: "Tags, wording and every chapter present",
          },
          {
            ok: !!review && review.passes > 0 && !reviewOpen.length,
            label: review?.passes
              ? `Checked against the sources by an independent review (${review.passes} ${review.passes === 1 ? "pass" : "passes"}, ${review.found} ${review.found === 1 ? "problem" : "problems"} fixed${reviewOpen.length ? `, ${reviewOpen.length} open` : ""})`
              : "Checked against the sources by an independent review",
            detail: reviewOpen,
          },
          {
            ok: !over,
            label: over
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
  const canSendBack = !!fit && (over || fit.issues.length > 0);
  const subtitle = spec
    ? `${folderName} · chapters ${spec.from}–${spec.to} · ${LAYOUTS[spec.layout].label}`
    : folderName;

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-8">
      <PanelHeader
        title="Cheatsheet"
        subtitle={subtitle}
        badge={
          fit && spec ? (
            <span
              data-numeric
              className={`ui-badge ${allPass ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}
            >
              {fit.pages} / {spec.pages} {spec.pages === 1 ? "page" : "pages"}
            </span>
          ) : null
        }
        actions={
          <div className="flex items-center gap-1.5">
            <button onClick={onShowLog} className="ui-btn ui-btn-xs ui-btn-ghost">
              Log
            </button>
            <button onClick={print} disabled={!fit} className="ui-btn ui-btn-xs ui-btn-secondary">
              Print…
            </button>
            <button
              onClick={savePdfFile}
              disabled={!fit || saving}
              title={allPass ? "Save to your Downloads folder" : "Some checks have not passed"}
              className={`ui-btn ui-btn-xs ${allPass ? "ui-btn-primary" : "ui-btn-secondary"}`}
            >
              {saving ? "Saving…" : allPass ? "Save PDF" : "Save PDF anyway"}
            </button>
          </div>
        }
        onClose={onClose}
        className="mb-4"
      />

      {!job ? (
        <p className="ui-empty">This cheatsheet is gone. Sheets live only until the app restarts, so make it again.</p>
      ) : status === "running" ? (
        <p className="ui-empty flex items-center gap-2">
          <SpinnerIcon className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          {round ? "Claude is revising the sheet, then it is checked and reviewed again…" : "Claude is writing the sheet…"}
        </p>
      ) : status !== "done" ? (
        <p className="ui-empty">The run did not finish. The log says why.</p>
      ) : error ? (
        <p className="ui-empty">
          {error === "gone"
            ? "This cheatsheet is gone. Sheets live only until the app restarts, so make it again."
            : error}
        </p>
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
              {canSendBack && (
                <button
                  onClick={sendBack}
                  disabled={asking}
                  className="ui-btn ui-btn-xs ui-btn-secondary mt-2.5"
                >
                  {asking ? "Sending…" : "Send back to Claude to fix"}
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
    </div>
  );
}
