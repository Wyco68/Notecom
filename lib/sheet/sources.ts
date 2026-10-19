// Checks a cheatsheet against its sources without a model: cheap, exact, and
// run on every reply before the (expensive) review session sees it.
//
// Two things a sheet gets wrong most often are also the two a program can
// catch: a chapter that never made it onto the sheet, and a number that is not
// in the notes — a port, a timer, a default, a bit count changed in passing.
// Numbers are compared as tokens, so "300" on the sheet must appear as "300"
// somewhere in the chapter files. Without slides that is a hard failure; with
// slides it is only a hint for the review, since a number may come from them.

export interface ChapterSource {
  seq: number;
  /** the chapter file's text, tags removed */
  text: string;
}

export function plainText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    // A slide picture's alt says what the picture shows; a fact read off it
    // (a year, a model number) is as sourced as one in the text.
    .replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");
}

/** Digit runs with their separators: 300, 802.1, 0200.3333.3333, 10:30, 2/3. */
export function numberTokens(text: string): Set<string> {
  const out = new Set<string>();
  // Thousands separators are a writing choice, not a different number.
  const t = text.replace(/(\d),(?=\d{3}\b)/g, "$1");
  for (const m of t.matchAll(/\d+(?:[.:/]\d+)*/g)) out.add(m[0]);
  return out;
}

export function sourceIssues(
  sheetHtml: string,
  chapters: ChapterSource[],
  hasExtras: boolean,
  /** text of added documents (quizzes, other lessons): their numbers count */
  extraTexts: string[] = []
): { hard: string[]; unverified: string[] } {
  const hard: string[] = [];

  const heads = [...sheetHtml.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => plainText(m[1]).trim());
  const covered = new Set(heads.map((h) => Number(/^(\d+)\./.exec(h)?.[1])));
  const missing = chapters.filter((c) => !covered.has(c.seq)).map((c) => c.seq);
  if (missing.length) {
    hard.push(`chapter(s) ${missing.join(", ")} have no <h2> on the sheet — every chapter in the range needs its own section`);
  }

  const known = new Set<string>();
  for (const t of [...chapters.map((c) => c.text), ...extraTexts]) for (const n of numberTokens(t)) known.add(n);
  // The chapter number that opens each heading is the app's numbering, not a fact.
  const body = sheetHtml.replace(/<h2[^>]*>\s*\d+\./g, "<h2>");
  const strays = [...numberTokens(plainText(body))].filter((n) => !known.has(n));

  if (!strays.length) return { hard, unverified: [] };
  if (hasExtras) return { hard, unverified: strays };
  hard.push(
    `numbers not found anywhere in the chapter notes: ${strays.slice(0, 30).join(", ")} — ` +
      `check each against the notes and correct or remove it`
  );
  return { hard, unverified: [] };
}
