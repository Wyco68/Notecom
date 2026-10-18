// Fits a laid-out sheet to its page limit by choosing the columns and font.
//
// The page count alone says nothing about empty paper: a sheet that fits two
// pages at 5pt may leave half the second page blank. So for a page-limited
// sheet every column count from 2 to 8 is tried, and for each the largest font
// that still fits the limit is found by halving the interval. The largest font
// wins — that is what fills the pages and is easiest to read — as long as a
// column holds a readable line; ties go to the fuller last page. Then the
// layout audit runs on the winner, and a close runner-up replaces it if the
// winner has layout problems the runner-up doesn't.
//
// A sheet with no page limit is not fitted: it uses its chosen (or default)
// columns at the layout's own font.

import { LAYOUTS, columnsOf, type SheetSpec } from "./layout";
import { auditLayout, lastPageFill, paginate, type LayoutIssue } from "./paginate";

export interface Fit {
  pages: number;
  font: number;
  columns: number;
  fill: number;
  issues: LayoutIssue[];
}

// A line shorter than this many characters wraps on every other word; longer
// than the upper bound, the eye loses its place. Average glyph width is about
// half the font size (a little less for a narrow face).
const MIN_LINE = 24;
const MAX_LINE = 75;

/** Lets the page breathe between layout passes, so the view stays responsive. */
const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));

export async function fitSheet(doc: Document, spec: SheetSpec, onProgress?: (text: string) => void): Promise<Fit> {
  const L = LAYOUTS[spec.layout];
  const numbered = spec.layout === "roomy";
  const finish = (columns: number, font: number): Fit => {
    const pages = paginate(doc, font, numbered, columns);
    return { pages, font, columns, fill: lastPageFill(doc), issues: auditLayout(doc) };
  };

  if (!spec.pages) return finish(columnsOf(spec.layout, spec.columns), L.font);

  const glyph = spec.layout === "dense" ? 0.44 : 0.5;
  const usablePt = ((L.width - 2 * L.margin) * 72) / 25.4;
  const lineChars = (columns: number, font: number) =>
    (usablePt - L.gap * (columns - 1)) / columns / (font * glyph);

  type Try = { columns: number; font: number; pages: number; fill: number; fits: boolean; readable: boolean };
  const tries: Try[] = [];
  for (let columns = 2; columns <= 8; columns++) {
    onProgress?.(`Trying ${columns} columns…`);
    await yieldToBrowser();
    // Columns too narrow to read even at the smallest font: skip.
    if (lineChars(columns, L.minFont) < MIN_LINE) continue;
    let lo = L.minFont;
    let hi = L.maxFont;
    let pages = paginate(doc, lo, numbered, columns);
    if (pages > spec.pages) {
      tries.push({ columns, font: lo, pages, fill: lastPageFill(doc), fits: false, readable: true });
      continue;
    }
    if (paginate(doc, hi, numbered, columns) <= spec.pages) {
      lo = hi;
    } else {
      while (hi - lo > 0.1) {
        const mid = Math.round(((lo + hi) / 2) * 100) / 100;
        if (paginate(doc, mid, numbered, columns) <= spec.pages) lo = mid;
        else hi = mid;
        await yieldToBrowser();
      }
    }
    const font = Math.floor(lo * 10) / 10;
    pages = paginate(doc, font, numbered, columns);
    const line = lineChars(columns, font);
    tries.push({ columns, font, pages, fill: lastPageFill(doc), fits: pages <= spec.pages, readable: line >= MIN_LINE && line <= MAX_LINE });
  }

  const fitting = tries.filter((t) => t.fits);
  const pool = fitting.filter((t) => t.readable).length ? fitting.filter((t) => t.readable) : fitting;
  if (!pool.length) {
    // Nothing fits even at the smallest font: show the closest, so the reader
    // sees by how much it is over and can send it back to be cut.
    const closest = [...tries].sort((a, b) => a.pages - b.pages || b.font - a.font)[0];
    onProgress?.("Laying out…");
    return finish(closest?.columns ?? L.columns, L.minFont);
  }
  // Largest font first; within a tenth of a point, the least empty paper —
  // the fuller last page. A sheet too short to fill its limit even at the
  // largest font ends on fewer pages rather than spilling a few lines onto
  // an otherwise empty one.
  const ranked = [...pool].sort(
    (a, b) => (Math.abs(b.font - a.font) > 0.05 ? b.font - a.font : 0) || b.fill - a.fill
  );
  onProgress?.("Checking the layout…");
  await yieldToBrowser();
  let best = finish(ranked[0].columns, ranked[0].font);
  for (const alt of ranked.slice(1, 3)) {
    if (!best.issues.length) break;
    if (ranked[0].font - alt.font > 0.6) break;
    const candidate = finish(alt.columns, alt.font);
    if (candidate.issues.length < best.issues.length) best = candidate;
  }
  // Leave the pages showing the winner.
  return best.columns === ranked[0].columns && best.font === ranked[0].font ? finish(best.columns, best.font) : best;
}
