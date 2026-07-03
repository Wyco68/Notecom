// Enforces docs/quiz-guidelines.md against actual quiz files.
//
// Same idea as validate-lesson.mjs: catch a drifted contract (missing
// Reasoning/Answer pair, a bare or out-of-order Q<n>, a disallowed tag)
// immediately instead of it silently accumulating. Run this after every
// /quiz save, see quiz.md.
//
// Usage:
//   node scripts/validate-quiz.mjs <path-to-quiz.html> [more paths...]
//   node scripts/validate-quiz.mjs --all   (checks every vault/**/quiz-*.html)

import { readFile, readdir } from "fs/promises";
import path from "path";

const ALLOWED_TAGS = new Set([
  "h1", "h2",
  "p", "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "td", "th",
  "pre", "code", "blockquote",
  "strong", "em", "div",
]);

function checkQuiz(html, file) {
  const errors = [];

  // Scan opening tags only; a closing tag adds nothing (its element already
  // has an opening tag) and would double-report every violation. Collect into
  // a Set so a tag used many times is flagged once.
  const disallowed = new Set();
  for (const m of html.matchAll(/<([a-zA-Z0-9]+)(?:\s[^>]*)?>/g)) {
    const tag = m[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) disallowed.add(tag);
  }
  for (const tag of disallowed) {
    errors.push(`disallowed tag <${tag}> — not in the quiz-guidelines allowlist`);
  }

  const h1Count = (html.match(/<h1>/g) ?? []).length;
  if (h1Count !== 1) {
    errors.push(`expected exactly one <h1> (quiz title), found ${h1Count}`);
  }

  if (/<h[3-6]>/.test(html)) {
    errors.push("found h3+ — quiz scheme is flat, one <h2> per question only");
  }

  const questionHeadings = [...html.matchAll(/<h2>\s*Q(\d+)\.[^<]*<\/h2>/g)];
  const allH2 = (html.match(/<h2>/g) ?? []).length;
  if (questionHeadings.length !== allH2) {
    errors.push(`found an <h2> that isn't "Q<n>. ..." — every h2 must be a question heading`);
  }

  let expected = 1;
  for (const m of questionHeadings) {
    const n = Number(m[1]);
    if (n !== expected) {
      errors.push(`question numbering out of order: expected Q${expected}, found Q${n}`);
    }
    expected++;
  }

  // Each question's h2 must be immediately followed by a Reasoning: then
  // an Answer: callout before the next h2 (or end of file).
  const blocks = html.split(/(?=<h2>)/).filter((b) => /^<h2>/.test(b));
  for (const block of blocks) {
    const qMatch = block.match(/<h2>\s*(Q\d+\..*?)<\/h2>/);
    const label = qMatch ? qMatch[1].trim() : "unknown question";
    const callouts = [...block.matchAll(/<blockquote>([\s\S]*?)<\/blockquote>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").trim()
    );
    if (callouts.length !== 2) {
      errors.push(`"${label}": expected exactly 2 callouts (Reasoning, Answer), found ${callouts.length}`);
      continue;
    }
    const [reasoning, answer] = callouts;
    if (!reasoning.startsWith("Reasoning:")) {
      errors.push(`"${label}": first callout must start with "Reasoning:"`);
    }
    if (!answer.startsWith("Answer:")) {
      errors.push(`"${label}": second callout must start with "Answer:"`);
    }
  }

  return errors.map((e) => `${file}: ${e}`);
}

async function findAllQuizzes() {
  const vaultRoot = path.join(process.cwd(), "vault");
  const folders = await readdir(vaultRoot, { withFileTypes: true });
  const files = [];
  for (const f of folders) {
    if (!f.isDirectory() || f.name.startsWith(".")) continue;
    const dir = path.join(vaultRoot, f.name);
    for (const entry of await readdir(dir)) {
      if (/^quiz-.*\.html$/.test(entry)) files.push(path.join(dir, entry));
    }
  }
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  const targets = args[0] === "--all" ? await findAllQuizzes() : args;

  if (targets.length === 0) {
    console.error("usage: node scripts/validate-quiz.mjs <file.html>... | --all");
    process.exit(1);
  }

  let allErrors = [];
  for (const file of targets) {
    const html = await readFile(file, "utf-8");
    allErrors = allErrors.concat(checkQuiz(html, file));
  }

  if (allErrors.length > 0) {
    console.error(`${allErrors.length} contract violation(s):\n`);
    allErrors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log(`${targets.length} quiz file(s) pass the quiz-guidelines contract.`);
}

main();
