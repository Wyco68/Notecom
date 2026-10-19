// The cheatsheet's paper and look, shared by the server (which tells /sheet
// how much room it has) and the client (which lays the reply out into pages).
//
// Two papers: a short limit (1-2 pages) gets A4 landscape, anything longer —
// or no limit — A4 portrait. The column count and font are not fixed: for a
// page-limited sheet the browser tries 2 to 8 columns and every font in the
// layout's range, and keeps the largest readable font that fills the pages
// (lib/sheet/fit.ts). Only a sheet with no page limit lets the reader choose
// its columns. The look is the colourful one of the reader's reference sheet:
// navy headings under a red chapter bar, navy table heads with striped rows,
// tinted boxes for groups, comparisons, warnings and rules, green code.

export type SheetLayout = "dense" | "roomy";

/** A document beyond the chapter range that a sheet also draws on — a quiz,
 *  or a lesson outside the range — added when the sheet was made or later. */
export interface SourceRef {
  kind: "lesson" | "quiz";
  id: string;
  title: string;
}

/** What a cheatsheet run was asked for. The app, not the CLI, picks the paper. */
export interface SheetSpec {
  /** first and last chapter (lesson seq) actually found in the range */
  from: number;
  to: number;
  /** the page limit; 0 means none — the sheet covers everything in full */
  pages: number;
  layout: SheetLayout;
  /** columns per page, 2–8: only for a sheet with no page limit, and only
   *  when the reader chose; a limited sheet's columns are fitted */
  columns?: number;
  /** file name for the printed sheet, without extension */
  title: string;
  /** documents added as sources beyond the chapters */
  extra?: SourceRef[];
}

/** The independent review of the current version, chapter by chapter, so a
 *  review that runs out of tokens keeps what it already checked. */
export interface SheetReview {
  /** chapters checked since they last changed */
  reviewed: number[];
  /** open findings per chapter, keyed by chapter number */
  issues: Record<string, string[]>;
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
  /** what the app's own checks say about the current version */
  checks?: string[];
  /** chapters not written yet — a write that stopped part-way */
  pending?: number[];
  messages: SheetMessage[];
  /** the pages as laid out on the machine that prints them (see
   *  lib/sheet/device-layout.ts); stale when `key` no longer matches */
  layout?: StoredLayout;
}

export interface StoredLayout {
  /** the fragment, spec and page styles this layout was made from */
  key: string;
  /** the laid-out pages, ready to show or print as they are */
  html: string;
  pages: number;
  font: number;
  columns: number;
  /** body line spacing the fitter settled on (older layouts: the base) */
  lineHeight?: number;
  fill: number;
  issues: Array<{ kind: string; page: number; text: string }>;
  at: string;
}

/** The review state of any stored meta, older shapes included. */
export function reviewOf(meta: SheetMeta | null | undefined): SheetReview {
  const r = meta?.review as Partial<SheetReview> | null | undefined;
  return { reviewed: Array.isArray(r?.reviewed) ? r!.reviewed : [], issues: (r?.issues as SheetReview["issues"]) ?? {} };
}

export interface LayoutSpec {
  /** paper size in mm */
  width: number;
  height: number;
  margin: number;
  /** default columns, and the only ones a no-limit sheet uses unless chosen */
  columns: number;
  /** column gap in pt */
  gap: number;
  /** body font in pt: the default, and the range fitting may use */
  font: number;
  minFont: number;
  maxFont: number;
  family: string;
  /** visible characters (no whitespace) one page holds at the default font,
   *  measured on the reference sheets — what the CLI is asked to aim for */
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
    maxFont: 10,
    family: `"Arial Narrow", "Liberation Sans Narrow", "Nimbus Sans Narrow", Arial, sans-serif`,
    budget: 25000,
    label: "A4 landscape",
  },
  roomy: {
    width: 210,
    height: 297,
    margin: 4,
    columns: 5,
    gap: 4,
    font: 5.5,
    minFont: 5,
    maxFont: 11,
    family: `Arial, "Liberation Sans", Helvetica, sans-serif`,
    budget: 12000,
    label: "A4 portrait",
  },
};

/** The highest page limit a sheet may set; past it, choose no limit. */
export const MAX_PAGES = 30;

/** Short limits get the dense landscape layout; longer ones, and no limit at
 *  all (0), the roomier portrait one. */
export function layoutFor(pages: number): SheetLayout {
  return pages >= 1 && pages <= 2 ? "dense" : "roomy";
}

export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 8;

/** A no-limit sheet's columns: the reader's choice, else the layout's own. */
export function columnsOf(layout: SheetLayout, columns?: number): number {
  return columns && columns >= MIN_COLUMNS && columns <= MAX_COLUMNS ? columns : LAYOUTS[layout].columns;
}

/** "A4 landscape, 6 columns", or "A4 portrait, columns fitted" for a limited
 *  sheet whose columns the browser picks. */
export function layoutLabel(spec: Pick<SheetSpec, "layout" | "pages" | "columns">, fitted?: number): string {
  const L = LAYOUTS[spec.layout];
  if (fitted) return `${L.label}, ${fitted} columns`;
  return spec.pages ? `${L.label}, columns fitted to the pages` : `${L.label}, ${columnsOf(spec.layout, spec.columns)} columns`;
}

/** "2 pages", "1 page", or "no page limit". */
export function pageLimitText(pages: number): string {
  return pages ? `${pages} ${pages === 1 ? "page" : "pages"}` : "no page limit";
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
 * engine has to fragment across sheets of paper. Columns and font are CSS
 * variables, set by the paginator for each try.
 */
/** The page styles, for telling whether a stored layout still matches them. */
export function sheetStyles(layout: SheetLayout): string {
  return sheetCss(layout);
}

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
 * PDF on the server. The policy forbids every load — no script, frame, font or
 * stylesheet fetch, and an image only as a data: URL, which is how the route
 * hands it the pictures — so the renderer can only draw what is inline,
 * whatever the markup says (it is also allowlisted: checkSheetPages).
 */
export function printDocument(
  pages: string,
  layout: SheetLayout,
  title: string,
  fontPt: number,
  columns: number,
  /** a stored layout shown in the app: its pictures load from /api/media */
  inApp = false,
  lineHeight = 1.17
): string {
  const policy = inApp ? "" : `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">\n`;
  return `<!doctype html>
<html lang="en" style="--fs: ${Number(fontPt)}pt; --cols: ${Number(columns)}; --lh: ${Number(lineHeight)}">
<head>
${policy}
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
  --fs: ${L.font}pt; --cols: ${L.columns}; --lh: 1.17;
  --navy: #1b2a5e; --ink: #1d1f24; --muted: #6b7183;
  --red: #b5122b; --ex: #b35900; --key: #6a3fb5;
  --rule: #d6d9e2; --zebra: #f2f3f9; --cell: #c9cdd9;
  --blue-bg: #e4f4fa; --blue: #2b93c2;
  --teal: #2e8b7a; --teal-bg: #edf7f3; --teal-ink: #17594d;
  --pink-bg: #fde9ec; --pink: #c62839;
  --violet-bg: #f1ecfb; --violet: #7a4fc8;
  --ex-bg: #fff0dc; --ex-edge: #e8892b; --ex-ink: #8a4300;
  --red-bg: #fde2e2; --red-edge: #d32f2f; --red-ink: #9b1111;
  --rose-bg: #fce7f3; --rose: #c2387f;
  --sun-bg: #fff6cc; --sun: #c9a000;
  --code-bg: #ecf6ea; --code: #4c9a58; --code-ink: #1f3d22;
}
@page { size: ${L.width}mm ${L.height}mm; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { background: #fff; }
body { color: var(--ink); font-family: ${L.family}; font-size: var(--fs); line-height: var(--lh);
  overflow-wrap: anywhere; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; width: ${L.width}mm; height: ${L.height}mm; padding: ${L.margin}mm;
  background: #fff; overflow: hidden; break-after: page; }
.page:last-child { break-after: auto; }
.cols { height: 100%; overflow: hidden; column-count: var(--cols); column-gap: ${L.gap}pt;
  column-rule: 0.4pt solid var(--rule); column-fill: auto; }
.pno { position: absolute; top: 0.6mm; right: ${L.margin}mm; font-size: 5pt; color: var(--muted); }
@media screen {
  html { background: #d9dce1; }
  body { padding: 12px; }
  .page { margin: 0 auto 12px; box-shadow: 0 1px 4px rgba(15, 23, 42, 0.25); }
}
@media print { body { padding: 0; } .page { margin: 0; box-shadow: none; } }

/* A chapter opens under a red bar; a topic is a navy heading. */
h2 { color: var(--navy); font-size: calc(var(--fs) + 2.6pt); font-weight: bold; line-height: 1.12;
  border-top: 1.6pt solid var(--red); padding-top: 1.4pt; margin: 3pt 0 1.2pt; break-after: avoid; }
.cols > h2:first-child { margin-top: 0; }
h3 { color: var(--navy); font-size: calc(var(--fs) + 1.2pt); font-weight: bold; line-height: 1.12;
  margin: 2.2pt 0 0.6pt; break-after: avoid; }
p { margin: 0 0 0.5pt; }
b, strong { color: var(--navy); }
/* Colour by kind, the reader's key: explanation light blue (.box), code
   green (pre), example orange (.ex, .box-ex), mix-up red (.warn,
   .box-warn), rule violet (.box-key), comparison teal (.cmp), and pink and
   yellow boxes for other groups the sources make. A line gets its colour
   as a background band with an edge, so it reads at a glance in print. */
.ex { color: var(--ex-ink); background: var(--ex-bg); }
p.ex, li.ex { border-left: 1.2pt solid var(--ex-edge); padding: 0 1pt 0 1.6pt; }
.warn { color: var(--red-ink); background: var(--red-bg); font-weight: bold; }
p.warn, li.warn { border-left: 1.2pt solid var(--red-edge); padding: 0 1pt 0 1.6pt; }
.key { color: var(--key); font-weight: bold; }
.f { color: var(--key); font-weight: bold; margin: 0.6pt 0; }
/* A slide picture: the column's width, its own shape, never taller than about
   a fifth of a portrait page. Its width/height attributes give the shape
   before it loads, so the paginator measures it right on the first pass. */
img { display: block; width: 100%; height: auto; max-height: 55mm; object-fit: contain;
  margin: 0.8pt 0; break-inside: avoid; }

ol, ul { margin: 0 0 0.8pt 7pt; }
ul { list-style: none; margin-left: 5pt; }
ul li::before { content: "\\25AA"; color: #8a90a6; font-size: 0.85em; margin-left: -5pt; width: 5pt; display: inline-block; }
li { margin: 0 0 0.2pt; }

table { width: 100%; border-collapse: collapse; margin: 1.2pt 0 1.6pt; break-inside: avoid; font-size: var(--fs); }
th, td { border: 0.4pt solid var(--cell); padding: 0.6pt 1.8pt; text-align: left; vertical-align: top;
  /* A cell never narrower than its longest word ("anywhere" would let the
     table squeeze "Table" into "Ta|ble"); a word longer than the column still
     breaks, and the layout audit reports a table that runs wide. */
  overflow-wrap: break-word; }
th { background: var(--navy); color: #fff; font-weight: bold; }
tr:nth-child(even) td { background: var(--zebra); }
td:first-child b, td:first-child strong { color: var(--navy); }

pre, code { font-family: Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace; }
pre { background: var(--code-bg); color: var(--code-ink); border-left: 1.6pt solid var(--code); border-radius: 1.5pt;
  font-size: calc(var(--fs) - 0.4pt); line-height: 1.14; padding: 1pt 2pt; margin: 1pt 0 1.4pt;
  white-space: pre-wrap; word-break: break-all; break-inside: avoid; }
pre .c { color: #6f7f70; }
code { background: var(--code-bg); color: var(--code-ink); font-weight: bold; font-size: calc(var(--fs) - 0.3pt);
  padding: 0 0.6pt; border-radius: 1pt; }
pre code { background: none; padding: 0; font-weight: normal; }

/* Boxes: an explanation or group of related facts (blue), a worked example
   (orange), a comparison (teal, with a title), a mix-up to avoid (red), a
   rule of thumb (violet), other groups (pink, yellow). Lines inside a box
   take the box's colour, not their own band. */
/* A box may continue in the next column, its colour and edge drawn again on
   each part: kept whole, a box too tall for the space left would move on and
   leave that space empty. Tables, code and pictures still never split. */
.box, .cmp, .box-warn, .box-key, .box-ex, .box-pink, .box-yellow, .box-q { margin: 1.2pt 0 1.6pt; padding: 1pt 2pt 1pt 2.4pt;
  -webkit-box-decoration-break: clone; box-decoration-break: clone; }
:is(.box, .cmp, .box-warn, .box-key, .box-ex, .box-pink, .box-yellow, .box-q) > :not(ul, ol) { break-inside: avoid; }
/* A list, in a box or not, splits between items, never inside one. */
li { break-inside: avoid; }
.box { background: var(--blue-bg); border-left: 1.6pt solid var(--blue); }
.box-ex { background: var(--ex-bg); border-left: 1.6pt solid var(--ex-edge); color: var(--ex-ink); }
.box-warn { background: var(--red-bg); border-left: 1.6pt solid var(--red-edge); }
.box-key { background: var(--violet-bg); border-left: 1.6pt solid var(--violet); }
.box-pink { background: var(--rose-bg); border-left: 1.6pt solid var(--rose); }
.box-yellow { background: var(--sun-bg); border-left: 1.6pt solid var(--sun); }
/* The reader's own class questions, set apart from the notes: grey with a
   dashed navy edge; each line is the question, then → its answer in bold. */
.box-q { background: #eef0f5; border: 0.6pt dashed var(--navy); border-radius: 1.5pt; }
:is(.box, .box-ex, .box-warn, .box-key, .box-pink, .box-yellow, .cmp) :is(p, li).ex,
:is(.box, .box-ex, .box-warn, .box-key, .box-pink, .box-yellow, .cmp) :is(p, li).warn { border-left: 0; padding-left: 0; background: none; }
.cmp { background: var(--teal-bg); border: 0.6pt solid var(--teal); border-radius: 2pt; padding: 1.2pt 2.4pt; }
.bt { color: var(--teal-ink); font-weight: 900; font-size: calc(var(--fs) + 0.8pt); margin-bottom: 0.6pt; letter-spacing: 0.1pt; }
.box ul, .box-warn ul, .box-key ul, .box-ex ul, .box-pink ul, .box-yellow ul, .box-q ul, .cmp ul { margin-left: 5pt; }
.box b, .box strong { color: #1d6f93; }
.box-warn b, .box-warn strong { color: var(--red-ink); }
.box-ex b, .box-ex strong { color: var(--ex-ink); }
.box-pink b, .box-pink strong { color: var(--rose); }
.box-yellow b, .box-yellow strong { color: #6b5500; }
.box-key b, .box-key strong { color: var(--violet); }
.cmp b, .cmp strong { color: var(--teal-ink); }
.cmp ul li::before { content: "\\25B8"; color: var(--teal); }
.cmp th { background: var(--teal-ink); }
hr { border: 0; border-top: 0.8pt dashed var(--teal); margin: 1pt 0; }

svg.d { display: block; width: 100%; height: auto; margin: 1.2pt 0; break-inside: avoid; }
svg.d text { font-family: inherit; font-size: 4px; fill: var(--ink); }
svg.d rect, svg.d circle, svg.d ellipse, svg.d polygon { stroke: var(--navy); stroke-width: 0.5; }
svg.d rect:not([class]), svg.d circle:not([class]), svg.d ellipse:not([class]), svg.d polygon:not([class]) { fill: #fff; }
svg.d line, svg.d path, svg.d polyline { stroke: var(--navy); stroke-width: 0.5; fill: none; }
.box-b { fill: #dcecf8; } .box-g { fill: #dff1e4; } .box-y { fill: #fff3c4; } .box-r { fill: #f9dde1; } .box-w { fill: #fff; }
`;
}
