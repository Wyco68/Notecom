// Enforces docs/html-output-contract.md against actual lesson files.
//
// This exists because the contract drifted silently before: older lessons
// kept bare "Concept" headings, standalone "Exam Tips"/"Remember"/"Diagram"
// headings, and a "Self Check" section the current contract doesn't have —
// nobody noticed until a user did. Run this after every /lect save so a
// violation fails loud immediately instead of accumulating.
//
// Usage:
//   node scripts/validate-lesson.mjs <path-to-lesson.html> [more paths...]
//   node scripts/validate-lesson.mjs --all   (checks every vault/**/*.html)

import { readFile, readdir } from "fs/promises";
import path from "path";

const ALLOWED_TAGS = new Set([
  "h1", "h2", "h3",
  "p", "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "td", "th",
  "pre", "code", "blockquote",
  "strong", "em", "div",
]);

const FORBIDDEN_H2 = new Set(["Concept", "Exam Tips", "Remember", "Diagram", "Self Check"]);
const CALLOUT_LABELS = ["Key Idea", "Common Mistake", "Exam Tip", "Remember"];

function checkLesson(html, file) {
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
    errors.push(`disallowed tag <${tag}> — not in the html-output-contract allowlist`);
  }

  const h1Count = (html.match(/<h1>/g) ?? []).length;
  if (h1Count !== 1) {
    errors.push(`expected exactly one <h1> (lesson title), found ${h1Count}`);
  }

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

  for (const m of html.matchAll(/<blockquote>([\s\S]*?)<\/blockquote>/g)) {
    const text = m[1].replace(/<[^>]+>/g, "").trim();
    const label = CALLOUT_LABELS.find((l) => text.startsWith(`${l}:`));
    if (!label) {
      errors.push(`callout doesn't start with one of ${CALLOUT_LABELS.join(", ")}: "${text.slice(0, 60)}..."`);
    }
  }

  return errors.map((e) => `${file}: ${e}`);
}

async function findAllLessons() {
  const vaultRoot = path.join(process.cwd(), "vault");
  const folders = await readdir(vaultRoot, { withFileTypes: true });
  const files = [];
  for (const f of folders) {
    if (!f.isDirectory() || f.name.startsWith(".")) continue;
    const dir = path.join(vaultRoot, f.name);
    for (const entry of await readdir(dir)) {
      if (/^\d+-.*\.html$/.test(entry)) files.push(path.join(dir, entry));
    }
  }
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  const targets = args[0] === "--all" ? await findAllLessons() : args;

  if (targets.length === 0) {
    console.error("usage: node scripts/validate-lesson.mjs <file.html>... | --all");
    process.exit(1);
  }

  let allErrors = [];
  for (const file of targets) {
    const html = await readFile(file, "utf-8");
    allErrors = allErrors.concat(checkLesson(html, file));
  }

  if (allErrors.length > 0) {
    console.error(`${allErrors.length} contract violation(s):\n`);
    allErrors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log(`${targets.length} lesson file(s) pass the html-output-contract.`);
}

main();
