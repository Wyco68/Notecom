// The cheatsheet's paper, shared by the server (which tells /sheet how much
// room it has) and the client (which lays the reply out into pages).
//
// Two layouts, copied from two hand-made sheets that worked in print: a short
// limit gets landscape with six narrow columns, a longer one portrait with
// five. The app picks it from the page limit; the CLI never chooses paper.

export type SheetLayout = "dense" | "roomy";

/** What a cheatsheet run was asked for. The app, not the CLI, picks the paper. */
export interface SheetSpec {
  /** first and last chapter (lesson seq) actually found in the range */
  from: number;
  to: number;
  pages: number;
  layout: SheetLayout;
  /** file name for the printed sheet, without extension */
  title: string;
}

/** How many review passes ran on the current version, what they found, and
 *  anything still open when the rounds ran out. */
export interface SheetReview {
  passes: number;
  found: number;
  open: string[];
}

/** One turn of a sheet's edit conversation. */
export interface SheetMessage {
  role: "user" | "assistant";
  text: string;
  /** ISO time */
  at: string;
}

/** What a stored sheet carries beside its HTML (notes_documents.meta). */
export interface SheetMeta {
  spec: SheetSpec;
  review: SheetReview | null;
  messages: SheetMessage[];
}

export interface LayoutSpec {
  /** paper size in mm */
  width: number;
  height: number;
  margin: number;
  columns: number;
  /** column gap in pt */
  gap: number;
  /** body font in pt: where fitting starts, and how far it may shrink */
  font: number;
  minFont: number;
  family: string;
  /** visible characters (no whitespace) one page holds, measured on the
   *  reference sheets — what the CLI is asked to aim for */
  budget: number;
  label: string;
}

export const LAYOUTS: Record<SheetLayout, LayoutSpec> = {
  dense: {
    width: 297,
    height: 210,
    margin: 2,
    columns: 6,
    gap: 3,
    font: 5,
    minFont: 4.5,
    family: `"Arial Narrow", "Liberation Sans Narrow", "Nimbus Sans Narrow", Arial, sans-serif`,
    budget: 25000,
    label: "A4 landscape, 6 columns",
  },
  roomy: {
    width: 210,
    height: 297,
    margin: 4,
    columns: 5,
    gap: 4,
    font: 5.5,
    minFont: 5,
    family: `Arial, "Liberation Sans", Helvetica, sans-serif`,
    budget: 12000,
    label: "A4 portrait, 5 columns",
  },
};

export const PAGE_LIMITS = [1, 2, 3, 4, 6, 8] as const;
export const MAX_PAGES = 12;

export function layoutFor(pages: number): SheetLayout {
  return pages <= 2 ? "dense" : "roomy";
}

/** Visible characters, whitespace excluded — the unit `budget` is in. */
export function visibleChars(html: string): number {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, "x")
    .replace(/\s/g, "").length;
}

/**
 * The whole printable document around a /sheet reply. The reply sits inert in
 * a <template>; `paginate` (./paginate.ts) deals it out into fixed-size pages,
 * which is what makes the page count exact and printing engine-independent —
 * each page is one plain multi-column box, never a column flow the print
 * engine has to fragment across sheets of paper.
 */
export function sheetDocument(body: string, layout: SheetLayout, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${sheetCss(layout)}</style>
</head>
<body>
<div id="pages"></div>
<template id="src">${body}</template>
</body>
</html>`;
}

/**
 * The same pages, already laid out by the browser, as a document to print to
 * PDF on the server. The policy forbids every load — no script, frame, image,
 * font or stylesheet fetch — so the renderer can only draw what is inline,
 * whatever the markup says (it is also allowlisted: checkSheetPages).
 */
export function printDocument(pages: string, layout: SheetLayout, title: string, fontPt: number): string {
  return `<!doctype html>
<html lang="en" style="--fs: ${Number(fontPt)}pt">
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${sheetCss(layout)}</style>
</head>
<body>
<div id="pages">${pages}</div>
</body>
</html>`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function sheetCss(layout: SheetLayout): string {
  const L = LAYOUTS[layout];
  return `
:root {
  --fs: ${L.font}pt;
  --blue: #1f4e9c; --blue-dark: #17365d; --ink: #111;
  --ex: #b35900; --warn: #c00000; --key: #6a1b9a;
  --rule: #bfbfbf; --head-bg: #dde6f2; --code-bg: #f1f1f1;
}
@page { size: ${L.width}mm ${L.height}mm; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { background: #fff; }
body { color: var(--ink); font-family: ${L.family}; font-size: var(--fs); line-height: 1.15;
  overflow-wrap: anywhere; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; width: ${L.width}mm; height: ${L.height}mm; padding: ${L.margin}mm;
  background: #fff; overflow: hidden; break-after: page; }
.page:last-child { break-after: auto; }
.cols { height: 100%; overflow: hidden; column-count: ${L.columns}; column-gap: ${L.gap}pt;
  column-rule: 0.4pt solid var(--rule); column-fill: auto; }
.pno { position: absolute; top: 0.6mm; right: ${L.margin}mm; font-size: 5pt; color: #666; }
@media screen {
  html { background: #d9dce1; }
  body { padding: 12px; }
  .page { margin: 0 auto 12px; box-shadow: 0 1px 4px rgba(15, 23, 42, 0.25); }
}
@media print { body { padding: 0; } .page { margin: 0; box-shadow: none; } }

h2 { color: var(--blue); font-size: calc(var(--fs) + ${layout === "dense" ? 2 : 2.5}pt); font-weight: bold;
  border-bottom: 0.6pt solid var(--blue); margin: 2.5pt 0 1pt; padding-bottom: 0.3pt; break-after: avoid; }
.cols > h2:first-child { margin-top: 0; }
h3 { color: var(--blue-dark); font-size: calc(var(--fs) + 0.4pt); font-weight: bold; margin: 1.6pt 0 0.2pt; break-after: avoid; }
p { margin: 0 0 0.4pt; }
.ex { color: var(--ex); }
.warn { color: var(--warn); }
.key { color: var(--key); font-weight: bold; }
.f { color: var(--key); font-weight: bold; margin: 0.6pt 0; }
ol, ul { margin: 0 0 0.6pt 7pt; }
ul { list-style: none; margin-left: 5pt; }
ul li::before { content: "\\25AA"; font-size: 0.8em; margin-left: -5pt; width: 5pt; display: inline-block; }
table { width: 100%; border-collapse: collapse; margin: 1pt 0 1.4pt; break-inside: avoid; font-size: var(--fs); }
th, td { border: 0.4pt solid #9a9a9a; padding: 0.4pt 1.6pt; text-align: left; vertical-align: top; }
th { background: var(--head-bg); font-weight: bold; }
pre, code { font-family: Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace; }
pre { background: var(--code-bg); font-size: calc(var(--fs) - 0.5pt); line-height: 1.12; padding: 0.8pt 1.5pt;
  margin: 0.8pt 0 1.2pt; white-space: pre-wrap; word-break: break-all; break-inside: avoid; }
pre .c { color: #6b6b6b; }
code { font-size: calc(var(--fs) - 0.3pt); }
svg.d { display: block; width: 100%; height: auto; margin: 1pt 0; break-inside: avoid; }
svg.d text { font-family: inherit; font-size: 4px; fill: var(--ink); }
svg.d rect, svg.d circle, svg.d ellipse, svg.d polygon { stroke: #333; stroke-width: 0.5; }
svg.d rect:not([class]), svg.d circle:not([class]), svg.d ellipse:not([class]), svg.d polygon:not([class]) { fill: #fff; }
svg.d line, svg.d path, svg.d polyline { stroke: #333; stroke-width: 0.5; fill: none; }
.box-b { fill: #dce9f7; } .box-g { fill: #dff0d8; } .box-y { fill: #fff3c4; } .box-r { fill: #f8dcdc; } .box-w { fill: #fff; }
`;
}
