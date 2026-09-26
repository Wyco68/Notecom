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
