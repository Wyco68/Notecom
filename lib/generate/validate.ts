// The output contracts, enforced by the app on what the CLI hands back.
//
// Generation used to end with the CLI running scripts/validate-*.mjs on the
// file it had just written, and trusting it to fix what failed. The CLI writes
// nothing now, so the check moved to the one place that decides whether a
// document is saved at all: nothing reaches Supabase without passing here.
// Rules: docs/html-output-contract.md (lessons), docs/quiz-guidelines.md
// (quizzes).

const LESSON_TAGS = new Set([
  "h1", "h2", "h3",
  "p", "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "td", "th",
  "pre", "code", "blockquote",
  "strong", "em", "div",
]);
const QUIZ_TAGS = new Set([...LESSON_TAGS].filter((t) => t !== "h3"));

const FORBIDDEN_H2 = new Set(["Concept", "Exam Tips", "Remember", "Diagram", "Self Check"]);
const CALLOUT_LABELS = ["Key Idea", "Common Mistake", "Exam Tip", "Remember"];

const calloutText = (html: string) =>
  [...html.matchAll(/<blockquote>([\s\S]*?)<\/blockquote>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, "").trim()
  );

// Opening tags only, each reported once: a closing tag would double-report.
function disallowedTags(html: string, allowed: Set<string>, contract: string): string[] {
  const bad = new Set<string>();
  for (const m of html.matchAll(/<([a-zA-Z0-9]+)(?:\s[^>]*)?>/g)) {
    const tag = m[1].toLowerCase();
    if (!allowed.has(tag)) bad.add(tag);
  }
  return [...bad].map((t) => `disallowed tag <${t}> — not in the ${contract} allowlist`);
}

function oneH1(html: string, what: string): string[] {
  const n = (html.match(/<h1>/g) ?? []).length;
  return n === 1 ? [] : [`expected exactly one <h1> (${what} title), found ${n}`];
}

export function checkLesson(html: string): string[] {
  const errors = [
    ...disallowedTags(html, LESSON_TAGS, "html-output-contract"),
    ...oneH1(html, "lesson"),
  ];
  if (/<h[4-6]>/.test(html)) {
    errors.push("found a heading deeper than h3 — contract caps headings at h3");
  }
  for (const m of html.matchAll(/<h2>([^<]*)<\/h2>/g)) {
    const text = m[1].trim();
    if (FORBIDDEN_H2.has(text)) {
      errors.push(
        text === "Concept"
          ? `bare "Concept" heading with no name — must be "Concept: <Specific Name>"`
          : `standalone "${text}" heading — contract says never emit this heading`
      );
    }
  }
  for (const text of calloutText(html)) {
    if (!CALLOUT_LABELS.some((l) => text.startsWith(`${l}:`))) {
      errors.push(
        `callout doesn't start with one of ${CALLOUT_LABELS.join(", ")}: "${text.slice(0, 60)}..."`
      );
    }
  }
  return errors;
}

export function checkQuiz(html: string): string[] {
  const errors = [
    ...disallowedTags(html, QUIZ_TAGS, "quiz-guidelines"),
    ...oneH1(html, "quiz"),
  ];
  if (/<h[3-6]>/.test(html)) {
    errors.push("found h3+ — quiz scheme is flat, one <h2> per question only");
  }

  const questions = [...html.matchAll(/<h2>\s*Q(\d+)\.[^<]*<\/h2>/g)];
  if (questions.length !== (html.match(/<h2>/g) ?? []).length) {
    errors.push(`found an <h2> that isn't "Q<n>. ..." — every h2 must be a question heading`);
  }
  questions.forEach((m, i) => {
    if (Number(m[1]) !== i + 1) {
      errors.push(`question numbering out of order: expected Q${i + 1}, found Q${m[1]}`);
    }
  });

  // Each question: its h2, then a Reasoning: and an Answer: callout, in order.
  for (const block of html.split(/(?=<h2>)/).filter((b) => b.startsWith("<h2>"))) {
    const label = block.match(/<h2>\s*(Q\d+\..*?)<\/h2>/)?.[1].trim() ?? "unknown question";
    const callouts = calloutText(block);
    if (callouts.length !== 2) {
      errors.push(`"${label}": expected exactly 2 callouts (Reasoning, Answer), found ${callouts.length}`);
      continue;
    }
    if (!callouts[0].startsWith("Reasoning:")) {
      errors.push(`"${label}": first callout must start with "Reasoning:"`);
    }
    if (!callouts[1].startsWith("Answer:")) {
      errors.push(`"${label}": second callout must start with "Answer:"`);
    }
  }
  return errors;
}

/**
 * The document out of the CLI's final reply. Asked for bare HTML, but a model
 * that wraps it in a code fence or a stray sentence shouldn't fail the run for
 * that alone — everything from the <h1> through the last closing tag is the
 * document, and the contract check decides the rest.
 */
export function extractHtml(reply: string): string | null {
  const start = reply.search(/<h1[\s>]/);
  if (start === -1) return null;
  const tail = reply.slice(start);
  const end = tail.lastIndexOf("</");
  if (end === -1) return null;
  const close = tail.indexOf(">", end);
  return close === -1 ? null : tail.slice(0, close + 1).trim();
}

/** Plain text of the one <h1> — the title always comes from the content. */
export function titleOf(html: string): string {
  const inner = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
  return inner
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// --- cheatsheets -------------------------------------------------------------
// Rules: docs/cheatsheet-guidelines.md. A sheet is a flat fragment the app
// wraps in its own page, so beyond the wording rules the check is about what
// may not reach that page: no script, no style, no link, no handler.

const SHEET_TAGS = new Set([
  "h2", "h3", "p", "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "th", "td",
  "pre", "code", "b", "strong", "i", "em", "sup", "sub", "span", "br",
  // a tinted box (only with one of the box classes) and the dashed rule
  // inside a comparison box
  "div", "hr",
  "svg", "g", "rect", "line", "path", "polyline", "polygon", "circle", "ellipse", "text", "tspan",
]);
const SHEET_ATTRS = new Set([
  "class", "colspan", "rowspan", "start",
  "viewbox", "x", "y", "x1", "y1", "x2", "y2", "dx", "dy", "width", "height",
  "cx", "cy", "r", "rx", "ry", "d", "points", "transform", "text-anchor", "xmlns",
]);
const SHEET_CLASSES = new Set([
  "ex", "warn", "key", "f", "c", "d", "box-b", "box-g", "box-y", "box-r", "box-w",
  "box", "cmp", "bt", "box-warn", "box-key",
]);
// Study talk and assistant voice. Case-insensitive, whole words where it matters.
// A rule marked `source` gives way when the chapters themselves use the word:
// "SNMP trap", "IP address assignment" and "robust" are terms there, and the
// sheet keeps every term as the source spells it. Dashes, study talk and
// labels never give way.
const SHEET_BANNED: Array<[RegExp, string, "source"?]> = [
  [/[–—]/, "em or en dash"],
  [/\bexams?\b/i, '"exam"'],
  [/\bquiz(zes)?\b/i, '"quiz"'],
  [/\bassignments?\b/i, '"assignment"', "source"],
  [/\btraps?\b/i, '"trap"', "source"],
  [/\btip:/i, '"tip:"'],
  [/\bQ&(amp;)?A\b/i, '"Q&A"'],
  [/\bnote that\b/i, '"note that"'],
  [/\b(key idea|summary|takeaway|ask|mistake|pro tip):/i, "a label such as Key idea:, Summary:, Ask:, Mistake:"],
  [/\b(this section|in summary|worth noting|let's)\b/i, "assistant phrasing"],
  [/\b(crucial|key role|vital role|delve|leverage|robust|seamless(ly)?)\b/i, "assistant phrasing", "source"],
  [/\bredrawn\b/i, '"redrawn"'],
];

/** The fragment out of the CLI's reply: from the first <h2> to the last closing tag. */
export function extractSheet(reply: string): string | null {
  const start = reply.search(/<h2[\s>]/);
  if (start === -1) return null;
  const tail = reply.slice(start);
  const end = tail.lastIndexOf("</");
  if (end === -1) return null;
  const close = tail.indexOf(">", end);
  return close === -1 ? null : tail.slice(0, close + 1).trim();
}

export interface ScannedTag {
  name: string;
  attrs: Array<{ name: string; value: string }>;
}

/**
 * Every tag in `html` with its attributes, split the way a browser's tokenizer
 * splits them — a "/" separates attributes as whitespace does, so
 * `<iframe/src=...>` is an iframe with a src, not text. A regex keyed on
 * whitespace misses exactly those. Comments, doctypes and processing
 * instructions are refused outright (null): a sheet needs none, and they are
 * where tokenizer edge cases live.
 */
export function scanTags(html: string): ScannedTag[] | null {
  if (html.includes("\0")) return null;
  const tags: ScannedTag[] = [];
  let i = 0;
  while ((i = html.indexOf("<", i)) !== -1) {
    const next = html[i + 1] ?? "";
    if (next === "!" || next === "?") return null;
    const closing = next === "/";
    const nameStart = closing ? i + 2 : i + 1;
    if (!/[a-zA-Z]/.test(html[nameStart] ?? "")) {
      // A bare "<" in text: the tokenizer reads it as text too.
      i++;
      continue;
    }
    let j = nameStart;
    while (j < html.length && !/[\s/>]/.test(html[j])) j++;
    const tag: ScannedTag = { name: html.slice(nameStart, j).toLowerCase(), attrs: [] };
    // Attributes, up to the closing ">".
    for (;;) {
      while (j < html.length && /[\s/]/.test(html[j])) j++;
      if (j >= html.length) return null;
      if (html[j] === ">") break;
      let k = j;
      while (k < html.length && !/[\s/>=]/.test(html[k])) k++;
      // The tokenizer takes a leading "=" into the name; so do we.
      if (k === j) k++;
      const name = html.slice(j, k).toLowerCase();
      let value = "";
      j = k;
      while (j < html.length && /\s/.test(html[j])) j++;
      if (html[j] === "=") {
        j++;
        while (j < html.length && /\s/.test(html[j])) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const close = html.indexOf(q, j + 1);
          if (close === -1) return null;
          value = html.slice(j + 1, close);
          j = close + 1;
        } else {
          k = j;
          while (k < html.length && !/[\s>]/.test(html[k])) k++;
          value = html.slice(j, k);
          j = k;
        }
      }
      if (!closing) tag.attrs.push({ name, value });
    }
    if (!closing) tags.push(tag);
    i = j + 1;
  }
  return tags;
}

/** Tags, attributes and classes outside an allowlist, as violations. */
function markupIssues(
  html: string,
  allow: { tags: Set<string>; attrs: Set<string>; classes: Set<string>; style?: RegExp },
  contract: string
): string[] {
  const tags = scanTags(html);
  if (!tags) return ["markup the tokenizer refuses: a comment, doctype or unterminated tag"];
  const badTags = new Set<string>();
  const badAttrs = new Set<string>();
  const badClasses = new Set<string>();
  for (const t of tags) {
    if (!allow.tags.has(t.name)) badTags.add(t.name);
    for (const a of t.attrs) {
      if (a.name === "style" && allow.style?.test(a.value.trim())) continue;
      if (!allow.attrs.has(a.name)) badAttrs.add(a.name);
      if (a.name === "class") {
        for (const c of a.value.split(/\s+/).filter(Boolean)) {
          if (!allow.classes.has(c)) badClasses.add(c);
        }
      }
    }
  }
  const errors = [...badTags].map((t) => `disallowed tag <${t}> — not in the ${contract} allowlist`);
  if (badAttrs.size) errors.push(`disallowed attribute(s): ${[...badAttrs].join(", ")}`);
  if (badClasses.size) errors.push(`unknown class(es): ${[...badClasses].join(", ")}`);
  return errors;
}

/**
 * The laid-out pages the browser sends to be printed (see
 * app/api/sheet/[id]/pdf): the sheet's own markup plus the page boxes the
 * paginator wrapped it in, and nothing else — the PDF renderer runs with file
 * access, so this is its input filter, not a style check.
 */
export function checkSheetPages(html: string): string[] {
  return markupIssues(
    html,
    {
      tags: SHEET_TAGS,
      attrs: SHEET_ATTRS,
      classes: new Set([...SHEET_CLASSES, "page", "cols", "pno"]),
      // The paginator's one inline style: a heading pushed to the next column.
      style: /^break-before:\s*column;?$/,
    },
    "printed sheet"
  );
}

/** `sourceText`: the chapters' plain text, for the rules a source term may override. */
const BOX_CLASSES = new Set(["box", "cmp", "box-warn", "box-key"]);

/**
 * The part of the sheet contract that guards the page rather than the
 * wording: allowlisted tags, attributes and classes, and a <div> only as one
 * of the boxes. A reply that fails this is never saved; one that passes is
 * saved even with other problems open, so a run that runs out of tokens
 * later still leaves a sheet behind (see lib/generate/sheet.ts).
 */
export function sheetMarkupIssues(html: string): string[] {
  const errors = markupIssues(
    html,
    { tags: SHEET_TAGS, attrs: SHEET_ATTRS, classes: SHEET_CLASSES },
    "cheatsheet-guidelines"
  );
  const tags = scanTags(html) ?? [];
  if (tags.some((t) => t.name === "div" && !t.attrs.some((a) => a.name === "class" && a.value.split(/\s+/).some((c) => BOX_CLASSES.has(c))))) {
    errors.push(`a <div> without a box class — a div is only ever one of: ${[...BOX_CLASSES].join(", ")}`);
  }
  return errors;
}

export function checkSheet(
  html: string,
  chapters: { from: number; to: number },
  sourceText = ""
): string[] {
  const errors = sheetMarkupIssues(html);

  const heads = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, "").trim()
  );
  if (!heads.length) errors.push("no <h2> — every chapter opens with a numbered <h2>");
  for (const h of heads) {
    const n = Number(/^(\d+)\./.exec(h)?.[1]);
    if (!n) errors.push(`<h2> "${h.slice(0, 60)}" does not start with its chapter number, like "3. Title"`);
    else if (n < chapters.from || n > chapters.to) {
      errors.push(`<h2> "${h.slice(0, 60)}" is outside chapters ${chapters.from}-${chapters.to}`);
    }
  }

  const text = html.replace(/<[^>]+>/g, " ");
  for (const [re, what, give] of SHEET_BANNED) {
    const m = re.exec(text);
    if (m && !(give && re.test(sourceText))) {
      const at = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, " ").trim();
      errors.push(`banned wording (${what}): "...${at}..."`);
    }
  }
  return errors;
}
