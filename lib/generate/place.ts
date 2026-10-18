// Picture mode: slide pictures added to a lesson that is already saved.
//
// Regenerating a lesson to add a few pictures would re-send the whole lesson
// both ways and could change wording the reader already learned from. So the
// run replies with placements only — which picture goes where, with its alt
// text and caption — and this puts them into the stored HTML. An anchor is a
// sentence copied from the lesson; the picture goes right after the block
// (paragraph, list, table, ...) that holds it. A placement may also name the
// sentence it makes obsolete ("the slide is only a picture"), which is taken
// out.

export interface Placement {
  picture: string;
  /** a sentence of the lesson; the picture goes after the block holding it */
  after?: string;
  /** a sentence the picture makes obsolete; removed, and the picture goes
   *  where it was */
  replaces?: string;
  alt: string;
  caption: string;
}

/** The JSON array out of the reply; null when there is none. */
export function parsePlacements(reply: string): Placement[] | null {
  const start = reply.indexOf("[");
  const end = reply.lastIndexOf("]");
  if (start === -1 || end < start) return null;
  try {
    const list = JSON.parse(reply.slice(start, end + 1));
    if (!Array.isArray(list)) return null;
    return list.map((p) => ({
      picture: String(p?.picture ?? ""),
      after: typeof p?.after === "string" ? p.after : undefined,
      replaces: typeof p?.replaces === "string" ? p.replaces : undefined,
      alt: String(p?.alt ?? ""),
      caption: String(p?.caption ?? ""),
    }));
  } catch {
    return null;
  }
}

interface Block {
  start: number;
  end: number;
  tag: string;
}

const VOID = new Set(["img", "br", "hr"]);

/** The fragment's top-level elements, in order. */
function blocks(html: string): Block[] {
  const out: Block[] = [];
  let depth = 0;
  let open: Block | null = null;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g)) {
    const tag = m[2].toLowerCase();
    if (VOID.has(tag)) continue;
    if (!m[1]) {
      if (depth === 0) open = { start: m.index!, end: -1, tag };
      depth++;
    } else {
      depth--;
      if (depth === 0 && open) {
        open.end = m.index! + m[0].length;
        out.push(open);
        open = null;
      }
    }
  }
  return out;
}

const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const escText = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const escAttr = (s: string) => escText(s).replace(/"/g, "&quot;");

/**
 * Applies the placements to `html`. Every problem is reported rather than
 * skipped, so the run can fix its list; the HTML is only meaningful when
 * there are none.
 */
export function placePictures(
  html: string,
  placements: Placement[],
  offered: ReadonlySet<string>
): { html: string; errors: string[] } {
  const errors: string[] = [];
  // Inserts and cuts, applied from the end so earlier offsets stay valid.
  const edits: Array<{ at: number; to: number; text: string; n: number }> = [];
  const cutBlocks = new Set<number>();
  const list = blocks(html);
  const texts = list.map((b) => plain(html.slice(b.start, b.end)));
  const find = (sentence: string) => {
    const want = plain(sentence);
    if (want.length < 12) return -1;
    return texts.findIndex((t) => t.includes(want));
  };

  for (const p of placements) {
    const label = `"${p.picture}"`;
    if (!offered.has(p.picture)) errors.push(`${label} is not one of the offered pictures`);
    if (!p.alt.trim()) errors.push(`${label} has no alt text`);
    if (!p.caption.trim()) errors.push(`${label} has no caption`);
    const anchor = p.replaces ?? p.after;
    if (!anchor) {
      errors.push(`${label} has neither "after" nor "replaces"`);
      continue;
    }
    const i = find(anchor);
    if (i === -1) {
      errors.push(`${label}: the sentence "${anchor.slice(0, 80)}" is not in the lesson — copy it exactly`);
      continue;
    }
    const b = list[i];
    const figure = `\n<figure><img src="${escAttr(p.picture)}" alt="${escAttr(p.alt.trim())}"><figcaption>${escText(p.caption.trim())}</figcaption></figure>`;

    if (p.replaces) {
      const cut = cutSentence(html.slice(b.start, b.end), p.replaces);
      if (cut === null) {
        errors.push(`${label}: could not take out "${p.replaces.slice(0, 80)}" — it must be one whole sentence of a paragraph or list item`);
        continue;
      }
      // Two cuts in one block would overlap; the run gets to pick.
      if (cutBlocks.has(i)) {
        errors.push(`${label}: another placement already takes a sentence out of the same block — use "after" for this one`);
        continue;
      }
      cutBlocks.add(i);
      edits.push({ at: b.start, to: b.end, text: cut + figure, n: edits.length });
    } else {
      edits.push({ at: b.end, to: b.end, text: figure, n: edits.length });
    }
  }
  if (errors.length) return { html, errors };

  // From the end backwards; pictures after the same block keep the run's order.
  let out = html;
  for (const e of edits.sort((a, b) => b.to - a.to || b.at - a.at || b.n - a.n)) {
    out = out.slice(0, e.at) + e.text + out.slice(e.to);
  }
  return { html: out, errors: [] };
}

/**
 * `block` without the sentence; "" when nothing else was in it (the whole
 * block goes), null when the sentence is not a clean piece of a <p> or <li>.
 */
function cutSentence(block: string, sentence: string): string | null {
  const want = sentence.trim();
  if (!/^<(p|ul|ol)[\s>]/.test(block)) return null;
  const at = block.indexOf(want);
  if (at === -1) return null;
  let out = block.slice(0, at) + block.slice(at + want.length);
  // Drop a list item, or the whole block, that is now empty.
  out = out.replace(/<li>\s*<\/li>\s*/g, "");
  if (!plain(out)) return "";
  return out.replace(/\n\s*\n/g, "\n").replace(/<p>\s+/, "<p>\n").replace(/\s+<\/p>/, "\n</p>");
}
