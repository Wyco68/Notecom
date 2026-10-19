// Deals a cheatsheet's blocks out into fixed-size pages, in the browser.
//
// Why not let print do it: a column flow fragmented across sheets of paper is
// exactly what print engines disagree on (Chrome, WebKitGTK and WebView2 each
// break it differently), and it gives no page count until after printing. Here
// every page is its own box of N columns with a fixed height; a block that
// spills into an (N+1)th column moves to the next page. The count is then
// exact, the preview is the print, and any engine prints one page per box.
//
// Runs against the document built by `sheetDocument` (./layout.ts), from the
// parent window — the preview iframe is sandboxed with no scripts of its own.

const HEADING = /^H[23]$/;
export const BASE_LINE_HEIGHT = 1.17;

/** `lineHeight`: body line spacing, which the fitter loosens to fill the last page. */
export function paginate(doc: Document, fontPt: number, numbered: boolean, columns: number, lineHeight = BASE_LINE_HEIGHT): number {
  const root = doc.getElementById("pages");
  const src = doc.getElementById("src") as HTMLTemplateElement | null;
  if (!root || !src) return 0;
  root.textContent = "";
  doc.documentElement.style.setProperty("--fs", `${fontPt}pt`);
  doc.documentElement.style.setProperty("--cols", String(columns));
  doc.documentElement.style.setProperty("--lh", String(lineHeight));

  const queue: Element[] = [...(src.content.cloneNode(true) as DocumentFragment).children];
  let cols = newPage(doc, root, numbered);
  // An extra column past the page's own is how a box reports overflow: its
  // height is fixed, so the content can only grow sideways.
  const fits = () => cols.scrollWidth <= cols.clientWidth + 1;

  while (queue.length) {
    const node = queue.shift()!;
    const wasEmpty = cols.childElementCount === 0;
    cols.appendChild(node);
    if (fits()) {
      // A heading left at the foot of a column, its text starting in the
      // next: push the heading over with it. If that overflows the page, the
      // branch below moves both to the next page.
      keepWithHeading(cols, node);
      if (fits()) continue;
    }

    const rest = splitTail(node, fits);
    if (rest) {
      queue.unshift(rest);
      cols = newPage(doc, root, numbered);
      continue;
    }

    if (wasEmpty) {
      // Taller than a whole page on its own: keep it (clipped) rather than
      // loop forever moving it from page to page.
      cols = newPage(doc, root, numbered);
      continue;
    }

    cols.removeChild(node);
    // A heading never ends a page — it moves with what it heads.
    const carry: Element[] = [];
    while (
      cols.lastElementChild &&
      HEADING.test(cols.lastElementChild.tagName) &&
      cols.childElementCount > 1
    ) {
      carry.unshift(cols.removeChild(cols.lastElementChild));
    }
    cols = newPage(doc, root, numbered);
    queue.unshift(...carry, node);
  }

  // A sheet that ends exactly on a page boundary leaves one blank page behind.
  const last = root.lastElementChild;
  if (last && !last.querySelector(".cols")?.childElementCount && root.childElementCount > 1) last.remove();
  return root.childElementCount;
}

function keepWithHeading(cols: HTMLElement, node: Element) {
  if (HEADING.test(node.tagName)) return;
  let head = node.previousElementSibling;
  if (!head || !HEADING.test(head.tagName)) return;
  while (head.previousElementSibling && HEADING.test(head.previousElementSibling.tagName)) {
    head = head.previousElementSibling;
  }
  const grid = gridOf(cols);
  const nodeCol = grid.columnOf(node.getClientRects()[0]);
  const headRects = head.getClientRects();
  const headCol = grid.columnOf(headRects[headRects.length - 1]);
  if (nodeCol > headCol) (head as HTMLElement).style.breakBefore = "column";
}

/** Where a page's columns are, from its .cols box. */
function gridOf(cols: HTMLElement) {
  const r = cols.getBoundingClientRect();
  const cs = cols.ownerDocument.defaultView!.getComputedStyle(cols);
  const n = parseInt(cs.columnCount, 10) || 1;
  const gap = parseFloat(cs.columnGap) || 0;
  const width = (r.width - gap * (n - 1)) / n;
  return {
    top: r.top,
    bottom: r.bottom,
    columnOf(rect: DOMRect | undefined): number {
      if (!rect) return 0;
      return Math.floor((rect.left - r.left + gap / 2) / (width + gap));
    },
    columnBounds(i: number) {
      const left = r.left + i * (width + gap);
      return { left, right: left + width };
    },
  };
}

/** How full the last page is, 0..1: its used columns plus the last column's
 *  share of the page height, over the page's columns. */
export function lastPageFill(doc: Document): number {
  const pages = doc.querySelectorAll<HTMLElement>("#pages > .page");
  const cols = pages[pages.length - 1]?.querySelector<HTMLElement>(".cols");
  if (!cols || !cols.lastElementChild) return 0;
  const grid = gridOf(cols);
  const n = parseInt(cols.ownerDocument.defaultView!.getComputedStyle(cols).columnCount, 10) || 1;
  let lastCol = 0;
  let bottom = grid.top;
  for (const el of cols.children) {
    for (const r of el.getClientRects()) {
      const c = grid.columnOf(r);
      if (c > lastCol) {
        lastCol = c;
        bottom = r.bottom;
      } else if (c === lastCol) {
        bottom = Math.max(bottom, r.bottom);
      }
    }
  }
  const height = grid.bottom - grid.top || 1;
  return Math.min(1, (lastCol + (bottom - grid.top) / height) / n);
}

export interface LayoutIssue {
  kind: "outside-column" | "overlap" | "clipped" | "cell-overflow" | "label-outside" | "label-overlap" | "orphan-heading" | "empty-page";
  page: number;
  /** a short quote of the text involved, so the writer can find it */
  text: string;
}

const LABELS: Record<LayoutIssue["kind"], string> = {
  "outside-column": "runs outside its column",
  overlap: "overlaps the block before it",
  clipped: "is cut off at the bottom of the page",
  "cell-overflow": "table cell text overflows its cell",
  "label-outside": "diagram label runs outside the diagram",
  "label-overlap": "diagram labels overlap",
  "orphan-heading": "heading is left at the foot of a column",
  "empty-page": "page is empty",
};

export function describeIssue(i: LayoutIssue): string {
  return `page ${i.page}: ${LABELS[i.kind]}${i.text ? ` ("${i.text}")` : ""}`;
}

const TOL = 0.75; // px of anti-aliasing slack

/**
 * Checks the laid-out pages the way a reader's eye would: every box inside its
 * own column, nothing on top of anything else, nothing cut off, no label
 * outside its diagram, no heading stranded from its text. Runs after paginate.
 */
export function auditLayout(doc: Document): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const quote = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const pages = [...doc.querySelectorAll<HTMLElement>("#pages > .page")];

  pages.forEach((page, p) => {
    const n = p + 1;
    const cols = page.querySelector<HTMLElement>(".cols");
    if (!cols || !cols.childElementCount) {
      issues.push({ kind: "empty-page", page: n, text: "" });
      return;
    }
    const grid = gridOf(cols);
    const seen = new Set<Element>();
    const flag = (kind: LayoutIssue["kind"], el: Element) => {
      const block = blockOf(el, cols);
      if (seen.has(block) && kind !== "label-overlap") return;
      seen.add(block);
      issues.push({ kind, page: n, text: quote(el) });
    };

    // Every rendered box, block or inline, stays inside the column it starts in.
    for (const el of cols.querySelectorAll("*")) {
      if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
      for (const rect of el.getClientRects()) {
        if (!rect.width && !rect.height) continue;
        const { left, right } = grid.columnBounds(grid.columnOf(rect));
        if (rect.left < left - TOL || rect.right > right + TOL) {
          flag("outside-column", el);
          break;
        }
        if (rect.bottom > grid.bottom + TOL) {
          flag("clipped", el);
          break;
        }
      }
    }

    // Blocks follow one another down a column; two that share space overlap.
    const blocks = [...cols.children];
    for (let i = 1; i < blocks.length; i++) {
      const a = blocks[i - 1].getClientRects();
      const b = blocks[i].getClientRects();
      const last = a[a.length - 1];
      const first = b[0];
      if (!last || !first) continue;
      const sameColumn = grid.columnOf(last) === grid.columnOf(first);
      if (sameColumn && first.top < last.bottom - TOL && first.left < last.right && last.left < first.right) {
        flag("overlap", blocks[i]);
      }
      if (HEADING.test(blocks[i - 1].tagName) && !HEADING.test(blocks[i].tagName) && !sameColumn) {
        flag("orphan-heading", blocks[i - 1]);
      }
    }

    for (const cell of cols.querySelectorAll<HTMLElement>("td, th, pre")) {
      if (cell.scrollWidth > cell.clientWidth + 1) flag("cell-overflow", cell);
    }

    for (const svg of cols.querySelectorAll("svg")) {
      const box = svg.getBoundingClientRect();
      const labels = [...svg.querySelectorAll("text")].map((t) => ({ t, r: t.getBoundingClientRect() }));
      for (const { t, r } of labels) {
        if (r.left < box.left - TOL || r.right > box.right + TOL || r.top < box.top - TOL || r.bottom > box.bottom + TOL) {
          flag("label-outside", t);
        }
      }
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i].r;
          const b = labels[j].r;
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w > TOL && h > TOL && w * h > 0.15 * Math.min(a.width * a.height, b.width * b.height)) {
            flag("label-overlap", labels[j].t);
          }
        }
      }
    }
  });
  return issues;
}

function blockOf(el: Element, cols: Element): Element {
  let b = el;
  while (b.parentElement && b.parentElement !== cols) b = b.parentElement;
  return b;
}

function newPage(doc: Document, root: HTMLElement, numbered: boolean): HTMLElement {
  const page = doc.createElement("div");
  page.className = "page";
  if (numbered) {
    const no = doc.createElement("span");
    no.className = "pno";
    no.textContent = String(root.childElementCount + 1);
    page.appendChild(no);
  }
  const cols = doc.createElement("div");
  cols.className = "cols";
  page.appendChild(cols);
  root.appendChild(page);
  return cols;
}

/**
 * A list or table that overflows gives up its trailing items to a copy of
 * itself, so a long one continues on the next page instead of moving whole.
 * Returns the copy holding the overflow, or null when even one item does not
 * fit (the caller moves the whole block). A table's header rows repeat.
 */
function splitTail(node: Element, fits: () => boolean): Element | null {
  const tag = node.tagName;
  let items: Element[];
  let into: Element;
  let rest: Element;

  if (tag === "UL" || tag === "OL") {
    items = [...node.children];
    rest = node.cloneNode(false) as Element;
    into = rest;
  } else if (tag === "TABLE") {
    const rows = [...node.querySelectorAll(":scope > tr, :scope > thead > tr, :scope > tbody > tr")];
    const head = rows.filter((r) => r.children.length && [...r.children].every((c) => c.tagName === "TH"));
    items = rows.filter((r) => !head.includes(r));
    rest = node.cloneNode(false) as Element;
    if (head.length) {
      const thead = rest.ownerDocument.createElement("thead");
      head.forEach((r) => thead.appendChild(r.cloneNode(true)));
      rest.appendChild(thead);
    }
    into = rest.ownerDocument.createElement("tbody");
    rest.appendChild(into);
  } else {
    return null;
  }
  if (items.length < 2) return null;

  const moved: Element[] = [];
  while (!fits() && items.length - moved.length > 1) {
    const item = items[items.length - 1 - moved.length];
    moved.unshift(item);
    item.remove();
  }
  if (!fits()) {
    // Not even the first item fits here: undo, let the whole block move.
    const parent = items[0].parentElement!;
    moved.forEach((m) => parent.appendChild(m));
    return null;
  }
  moved.forEach((m) => into.appendChild(m));
  if (tag === "OL") {
    const start = Number(node.getAttribute("start") || 1);
    rest.setAttribute("start", String(start + node.children.length));
  }
  return rest;
}
