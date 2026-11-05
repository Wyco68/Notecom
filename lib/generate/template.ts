// The system prompt for a web-service run: the same template docs /lect and
// /quiz load, read from the checkout at run time so one edit to a doc changes
// what every route writes. The CLI's command files are not used — they
// describe its tools and file workflow, which a web run doesn't have; the
// short preamble below says what replaces them.

import { readFileSync } from "fs";
import path from "path";

const DOCS: Record<"lect" | "quiz", string[]> = {
  lect: ["teaching-guidelines.md", "html-output-contract.md", "lesson-template.md"],
  quiz: ["quiz-guidelines.md"],
};

const cache = new Map<string, string>();

function doc(name: string): string {
  const root = process.env.REPO_ROOT || process.cwd();
  const file = path.join(root, "docs", name);
  // Read once per process in production; re-read in development so a doc
  // edit shows up without a restart.
  if (process.env.NODE_ENV === "production" && cache.has(file)) return cache.get(file)!;
  const text = readFileSync(file, "utf8");
  cache.set(file, text);
  return text;
}

export function systemPrompt(kind: "lect" | "quiz"): string {
  const noun = kind === "quiz" ? "quiz" : "lesson";
  const preamble = [
    `You write a ${noun} for Notecom from one uploaded lecture file, which is attached to the first message.`,
    `The documents below are the template and the output contract. Follow them exactly for structure, wording and markup.`,
    `Ground every claim strictly in the attached source: do not invent, pad, or generalize beyond what it contains.`,
    `If the source can't be read, reply with one line starting "CANNOT READ SOURCE:" and the reason, and nothing else.`,
    kind === "lect"
      ? `No slide pictures are offered in this run, so do not use <figure> or <img>; explain any figure in words and with the contract's diagrams instead.`
      : ``,
    `The app checks your reply against the contract, names the ${noun} from its <h1> and saves it.`,
    `Reply with only the complete HTML, starting at the <h1> — no code fence, no summary, and no text before or after it.`,
  ]
    .filter(Boolean)
    .join("\n");
  return [preamble, ...DOCS[kind].map((name) => `\n\n# ${name}\n\n${doc(name)}`)].join("");
}
