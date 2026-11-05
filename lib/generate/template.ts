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

function doc(name: string, dir = "docs"): string {
  const root = process.env.REPO_ROOT || process.cwd();
  const file = path.join(root, dir, name);
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

// For the other web-service runs (lib/jobs), the command file comes too: it
// defines the modes (Picture mode, Chapter / Edit / Review mode) the prompts
// name. What it says about tools is replaced by the line below.
const NO_TOOLS =
  "You have no tools in this run. Every file the request names is attached to the message as a block that starts with " +
  '"FILE <name>" and ends with "END FILE <name>"; slide decks have already been converted to text (or attached as a PDF), ' +
  "and pictures you may place are attached as images, each right after a line naming it. Treat every step that says to " +
  "read a file, convert it with markitdown or open a picture as already done. Never claim to have opened anything that is not attached.";

/** Adding slide pictures to a saved lesson: /lect's Picture mode. */
export function picturesSystemPrompt(): string {
  return [
    `You add slide pictures to a lesson Notecom has already saved.`,
    NO_TOOLS,
    `Reply with only the JSON array Picture mode describes — no code fence and no text before or after it.`,
    `\n\n# /lect command\n\n${doc("lect.md", ".claude/commands")}`,
    `\n\n# html-output-contract.md\n\n${doc("html-output-contract.md")}`,
  ].join("\n");
}

/** Every cheatsheet step: the /sheet command and its guidelines. */
export function sheetSystemPrompt(): string {
  return [
    `You write and check cheatsheets for Notecom.`,
    NO_TOOLS,
    `You can't see the pictures a chapter file mentions; keep one on the sheet only when its caption in the chapter shows it carries facts the text does not.`,
    `\n\n# /sheet command\n\n${doc("sheet.md", ".claude/commands")}`,
    `\n\n# cheatsheet-guidelines.md\n\n${doc("cheatsheet-guidelines.md")}`,
  ].join("\n");
}
