// Splits a lesson document into educational sections for search.
//
// Ported from indexd's chunker.go when search moved into Postgres. The rule is
// unchanged: every <h2> opens a topic, every <h3> opens a chunk inside it, and
// content before the first heading lands in an "Overview" chunk. Fixed token
// windows would cut explanations mid-thought; heading boundaries are how the
// lessons are actually taught (docs/architecture.md).
//
// No HTML parser dependency, because none is needed: generated lessons are a
// flat fragment of the allowlisted tags in docs/html-output-contract.md — no
// <html>/<body> wrapper, and headings are never nested inside a <div> (the only
// divs are the self-contained mermaid/viz blocks). If that contract ever allows
// nested headings, this needs a real parser.

export interface Chunk {
  topic: string;
  heading: string;
  headingIndex: number;
  summary: string;
  keywords: string;
  /** plain text of the section — what full-text search actually matches */
  body: string;
  html: string;
}

// Top-level headings, in document order. `[^>]*` allows attributes even though
// the contract forbids them: tolerating them costs nothing and mis-parsing a
// heading would silently drop a whole section from search.
const HEADING = /<(h[123])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;

/** Strips tags and collapses whitespace — the text a reader would see. */
export function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export function chunkHTML(src: string): { title: string; chunks: Chunk[] } {
  let title = "";
  let topic = "Overview";
  const chunks: Chunk[] = [];

  // Occurrences of each heading text so far, so a repeated "How it Works" can
  // be addressed as "the Nth one" by the viewer's scroll-to-hit.
  const seenHeading = new Map<string, number>();

  // sections: [heading level, heading text, body html] in document order, plus
  // an optional leading section for content that precedes the first heading.
  const marks: Array<{ level: number; text: string; start: number; end: number }> = [];
  HEADING.lastIndex = 0;
  for (let m = HEADING.exec(src); m; m = HEADING.exec(src)) {
    marks.push({
      level: Number(m[1][1]),
      text: textOf(m[2]),
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  const push = (heading: string, bodyHTML: string) => {
    const body = textOf(bodyHTML);
    if (!body && !bodyHTML.trim()) return;
    const n = seenHeading.get(heading) ?? 0;
    seenHeading.set(heading, n + 1);
    chunks.push({
      topic,
      heading,
      headingIndex: n,
      summary: firstSentences(body, 280),
      keywords: extractKeywords(bodyHTML),
      body,
      html: bodyHTML.trim(),
    });
  };

  // Content before the first heading — a lesson that opens straight into prose.
  const lead = marks.length ? src.slice(0, marks[0].start) : src;
  if (textOf(lead)) push("Overview", lead);

  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    const bodyHTML = src.slice(mark.end, marks[i + 1]?.start ?? src.length);
    if (mark.level === 1) {
      // The <h1> is the document title, not a section.
      if (!title) title = mark.text;
      if (textOf(bodyHTML)) push("Overview", bodyHTML);
      continue;
    }
    if (mark.level === 2) topic = mark.text;
    push(mark.text, bodyHTML);
  }

  return { title, chunks };
}

function firstSentences(text: string, max: number): string {
  const r = [...text];
  if (r.length <= max) return text;
  const cut = r.slice(0, max).join("");
  const i = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  if (i > max / 2) return cut.slice(0, i + 1);
  return cut.trim() + "…";
}

// The lesson format bolds exactly the exam-relevant vocabulary, which makes
// <strong>/<code> terms free, high-precision keywords.
const TERM = /<(strong|code)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;

export function extractKeywords(html: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  TERM.lastIndex = 0;
  for (let m = TERM.exec(html); m; m = TERM.exec(html)) {
    const t = textOf(m[2]);
    const lower = t.toLowerCase();
    // Skip multi-line code blocks and duplicates.
    if (!t || t.length > 60 || seen.has(lower)) continue;
    seen.add(lower);
    out.push(t);
    if (out.length === 15) break;
  }
  return out.join(", ");
}
