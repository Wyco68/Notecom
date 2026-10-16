// Headless Claude Code job runner for in-app lesson/quiz generation.
//
// The app never generates content itself — it delegates to the local
// Claude Code CLI (the same `/lect` / `/quiz` commands used in a terminal),
// which runs on the user's existing Claude subscription. No API key, no
// separate billing. Desktop/local only by design.
//
// The CLI is an author and nothing more: it reads the upload and replies with
// HTML. It cannot write — the run is limited to reading tools — so checking
// the contract, naming, numbering and saving all happen here and in
// ./save.ts, and a document reaches Supabase only through the app.
//
// CLAUDE_BIN overrides the binary — used by tests to substitute a stub so
// verification never burns tokens or writes a real lesson.

import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { rm, writeFile } from "fs/promises";
import path from "path";
import { checkLesson, checkQuiz, checkSheet, extractHtml, extractSheet } from "./validate";
import { saveGenerated, saveSheet, type SavedDoc } from "./save";
import { LAYOUTS, visibleChars, type SheetMessage, type SheetReview, type SheetSpec } from "../sheet/layout";
import { plainText, sourceIssues, type ChapterSource } from "../sheet/sources";

export type JobKind = "lect" | "quiz" | "sheet";

interface SheetRun {
  dir: string;
  chapters: Array<{ seq: number; path: string }>;
  extras: string[];
  sources: ChapterSource[];
  model: string;
  effort: string;
}

/** An edit of a stored sheet: which one, and what the reader asked for. */
export interface SheetEdit {
  docKey: string;
  request: string;
}

export interface Job {
  id: string;
  /** "ready": generated and contract-checked, waiting for the save request
   *  (see saveJob) — the one step that needs the caller's session. */
  status: "running" | "ready" | "done" | "error" | "aborted";
  folder: string;
  kind: JobKind;
  /** set on cheatsheet runs only */
  sheet?: SheetSpec;
  /** the CLI session of the last writing round; a fix round resumes it */
  sessionId?: string;
  /** set when this sheet run edits a stored sheet rather than making one */
  edit?: SheetEdit;
  /** the writer's one-line account of what it did, shown in the conversation */
  note?: string;
  /** a sheet's inputs: the temp dir holding the chapter files and slides, the
   *  chapters' text for the source check, the slide paths, and the model and
   *  effort it runs on. Server-side only — never listed. */
  sheetRun?: SheetRun;
  /** what the source checks and the review session found */
  review?: SheetReview;
  log: string[];
  startedAt: number;
  tokens: { input: number; output: number };
  /** set when the run failed because the CLI has no valid session — the UI
   *  offers sign-in instead of a bare "try again" */
  needsAuth?: boolean;
  /** live process handle — undefined once the job has finished */
  child?: ChildProcess;
  /** the signed-in user who started this job. The CLI itself has no notion of
   *  per-request identity (it runs as one shared subprocess), so this is the
   *  only thing standing between "list every job on the box" and "list mine" —
   *  every read/write below is scoped by it. */
  startedBy: string;
  /** the checked document, held in memory only until it is saved */
  html?: string;
  saving?: Promise<SavedDoc>;
  saved?: SavedDoc;
}

// A contract failure goes back to the same CLI session with the violations
// listed, rather than failing the run outright — most are a heading or a
// callout label, cheap to fix in place. Bounded, because each round re-sends
// the whole document.
const MAX_FIXES = 2;

// The only tools the run may use: reading the upload and the /lect or /quiz
// docs, and converting the upload. `dontAsk` refuses anything else outright
// instead of prompting a headless process that can't answer — which is what
// makes "the CLI never writes" a property of the run, not a request in the
// prompt.
const ALLOWED_TOOLS = "Read,mcp__markitdown__convert_to_markdown";

// globalThis survives Next.js dev hot-reload; a plain module Map doesn't.
const jobs: Map<string, Job> =
  (globalThis as any).__generateJobs ?? ((globalThis as any).__generateJobs = new Map());

// One chain per folder: a document's seq is "max existing + 1", read when it
// is saved, so two runs finishing together in the same folder could read the
// same max — or simply finish in a different order than the user started
// them in. Chaining a same-folder run behind the previous one (each link
// resolves once its run has ended) is what keeps 1, 2, 3 landing as 1, 2, 3 —
// a different folder's runs are a different chain and still run fully in
// parallel, up to MAX_CONCURRENT_JOBS on the client.
const folderChains: Map<string, Promise<void>> =
  (globalThis as any).__generateFolderChains ?? ((globalThis as any).__generateFolderChains = new Map());

/** Scoped to the caller: a job id is unguessable but that buys nothing if
 *  anyone signed in can just ask for it by id. Returns undefined for someone
 *  else's job exactly as it would for a job that never existed — a caller
 *  probing ids learns nothing either way. */
export function getJob(id: string, userId: string): Job | undefined {
  const job = jobs.get(id);
  return job && job.startedBy === userId ? job : undefined;
}

/**
 * This caller's jobs this server process knows about, newest first, without
 * the log, the document or the child handle — enough for a reloaded client to
 * spot a run still in flight (or one waiting to be saved) and re-attach to its
 * stream. The log itself comes from the tail, which replays from the
 * beginning anyway.
 */
export function listJobs(
  userId: string
): Array<
  Pick<Job, "id" | "status" | "folder" | "kind" | "sheet" | "edit" | "startedAt" | "tokens" | "needsAuth" | "saved">
> {
  // Picked, not spread: a job carries server-side state (temp paths, source
  // text, the CLI session) that has no business leaving this process.
  return [...jobs.values()]
    .filter((j) => j.startedBy === userId)
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(({ id, status, folder, kind, sheet, edit, startedAt, tokens, needsAuth, saved }) => ({
      id, status, folder, kind, sheet, edit, startedAt, tokens, needsAuth, saved,
    }));
}

export function startJob(
  folder: string,
  kind: "lect" | "quiz",
  filePath: string,
  originalName: string,
  startedBy: string
): Job {
  const job: Job = {
    id: randomUUID(),
    status: "running",
    folder,
    kind,
    log: [],
    startedAt: Date.now(),
    tokens: { input: 0, output: 0 },
    startedBy,
  };
  jobs.set(job.id, job);

  // /lect and /quiz only exist as this repo's command files — Claude Code
  // expands them from .claude/commands/ in its working directory, so the
  // CLI must run from the checkout. In dev that's process.cwd(); in the
  // packaged app the standalone server's cwd is the installed resources
  // dir, and the Tauri shell passes the checkout as REPO_ROOT instead.
  const repoRoot = process.env.REPO_ROOT || process.cwd();
  if (!commandReady(job, repoRoot, [filePath])) return job;

  const safeOriginal = oneLine(originalName);
  const noun = kind === "quiz" ? "quiz" : "lesson";
  const prompt =
    `/${kind} ` +
    // The destination is the app's business, not the CLI's: it was chosen in
    // the Generate dialog and the document is filed there after it comes back.
    `The app files the ${noun} itself — do not create, write or edit any file or folder, and do not look for vault/ or index.json; you only have read access. ` +
    `The uploaded lecture file is saved at ${filePath} (original name: ${safeOriginal}); ` +
    `read it from that path and convert it with the markitdown tool, then continue the command workflow. ` +
    // The /${kind} docs are the single source of truth for structure and style.
    `Follow the /${kind} command's own template and output contract exactly for structure and style. ` +
    // Strict generation: the document's content is the uploaded file, not the
    // model's prior knowledge. Grounding it in the source (and failing rather
    // than fabricating) is what keeps the saved document faithful to the
    // actual lecture.
    `Ground every claim strictly in that uploaded source; do not invent, pad, or generalize beyond what it contains. If the file cannot be read or converted, stop and report that instead of fabricating a ${noun}. ` +
    // The reply IS the output — the app extracts the document from it.
    `When the ${noun} is ready, reply with only its complete HTML, starting at the <h1> — no code fence, no summary, and no text before or after it.`;

  // Queue behind whatever is already running in this same folder — see
  // folderChains above. `.catch()` on the stored link (not the returned
  // promise) so one run's rejection can never wedge the folder's queue for
  // whatever comes after it.
  if (folderChains.has(folder)) {
    job.log.push(`Queued — waiting for another generation in "${folder}" to finish first.`);
  }
  const priorInFolder = folderChains.get(folder) ?? Promise.resolve();
  const thisRun = priorInFolder.then(() => generate(job, repoRoot, [filePath], prompt, safeOriginal));
  folderChains.set(folder, thisRun.catch(() => {}));

  return job;
}

/**
 * A cheatsheet run: a new sheet, or — with `edit` — a new version of a stored
 * one, written from the reader's message. `dir` holds the inputs: one HTML
 * file per chapter, read from Supabase by the route as the caller, any
 * uploaded slides, and for an edit the current sheet, the request and the
 * conversation so far. It is removed when the run ends. Either way the result
 * ends "ready" and is saved by the client's request (saveJob), like a lesson.
 */
export function startSheetJob(
  folder: string,
  spec: SheetSpec,
  dir: string,
  chapters: Array<{ seq: number; path: string }>,
  extras: string[],
  startedBy: string,
  edit?: SheetEdit & { current: string; history: SheetMessage[] }
): Job {
  const job: Job = {
    id: randomUUID(),
    status: "running",
    folder,
    kind: "sheet",
    sheet: spec,
    log: [],
    startedAt: Date.now(),
    tokens: { input: 0, output: 0 },
    startedBy,
    edit: edit && { docKey: edit.docKey, request: edit.request },
    sheetRun: {
      dir,
      chapters,
      extras,
      sources: chapters.map((c) => ({ seq: c.seq, text: plainText(readFileSync(c.path, "utf8")) })),
      model: process.env.SHEET_MODEL || SHEET_MODEL,
      effort: process.env.SHEET_EFFORT || SHEET_EFFORT,
    },
  };
  jobs.set(job.id, job);

  const repoRoot = process.env.REPO_ROOT || process.cwd();
  if (!commandReady(job, repoRoot, [dir])) return job;

  const L = LAYOUTS[spec.layout];
  const sources =
    `Chapter files, in order: ${chapters.map((c) => oneLine(c.path)).join(", ")}. ` +
    (extras.length
      ? `Extra source files (slides) to check the notes against: ${extras.map(oneLine).join(", ")}; convert them with the markitdown tool. `
      : `There are no extra source files. `) +
    `Page limit: ${spec.pages} page(s), ${L.label}, body font ${L.font}pt. ` +
    `Character budget: about ${(L.budget * spec.pages).toLocaleString("en-US")} visible characters, whitespace excluded; aim for 90 to 100 percent of it. ` +
    `Ground every fact strictly in these files; if a file cannot be read, stop and say so instead of guessing. `;

  let prompt: string;
  if (edit) {
    // Files, not the prompt, carry the reader's words: the prompt must be one
    // line with quotes stripped (oneLine), and a request should arrive intact.
    const current = path.join(dir, "current-sheet.html");
    const request = path.join(dir, "request.txt");
    const history = path.join(dir, "conversation.txt");
    writeFileSync(current, edit.current.replace(/(<(?:h2|h3|p|li|tr|table|ul|ol|pre|svg)[\s>])/g, "\n$1"));
    writeFileSync(request, edit.request);
    writeFileSync(
      history,
      edit.history.slice(-12).map((m) => `${m.role === "user" ? "Reader" : "You"}: ${m.text}`).join("\n\n") || "(none)"
    );
    prompt =
      `/sheet Edit mode. Do not create, write or edit any file; you only have read access. ` +
      `The current cheatsheet for chapters ${spec.from} to ${spec.to} is at ${oneLine(current)}. ` +
      `The reader's request is in ${oneLine(request)}, and the conversation so far is in ${oneLine(history)}. ` +
      sources +
      `Change what the request asks and keep everything else; every rule of the cheatsheet guidelines still applies, and nothing may come from outside the source files. ` +
      `If the request asks for something the sources do not support, leave the sheet as it is for that part and say so. ` +
      `Reply with one line starting "NOTE:" that tells the reader in plain words what you changed, then the complete fragment, starting at the first <h2>.`;
  } else {
    prompt =
      `/sheet ` +
      `Make one cheatsheet for chapters ${spec.from} to ${spec.to}. Do not create, write or edit any file; you only have read access, and the app lays out and prints the sheet itself. ` +
      sources +
      `When the sheet is ready, reply with one line starting "NOTE:" that tells the reader in plain words what the sheet covers and anything you had to leave out, then its HTML fragment, starting at the first <h2>: no code fence and nothing after it.`;
  }

  const label = edit ? `edit of ${edit.docKey}` : `chapters ${spec.from}-${spec.to}, ${spec.pages} page(s)`;
  generateSheet(job, repoRoot, prompt, label);
  return job;
}

// Without the command file, claude "succeeds" with a confused one-turn reply
// and no document — fail fast and say why.
function commandReady(job: Job, repoRoot: string, inputs: string[]): boolean {
  const commandFile = path.join(repoRoot, ".claude", "commands", `${job.kind}.md`);
  if (existsSync(commandFile)) return true;
  job.log.push(
    `Generate needs the project checkout: /${job.kind} is defined by .claude/commands/${job.kind}.md, ` +
      `which doesn't exist at ${repoRoot}.`,
    "Check the app was set up per docs/GETTING_STARTED.md (clone + npm run setup)."
  );
  job.status = "error";
  for (const p of inputs) rm(p, { recursive: true, force: true }).catch(() => {});
  return false;
}

// What each kind of run must hand back, and what happens once it does.
interface Contract {
  noun: string;
  /** what the reply must start at, for the fix prompt */
  startsAt: string;
  extract: (reply: string) => string | null;
  check: (html: string) => string[];
  accept: (html: string) => void;
}

function contractFor(job: Job): Contract {
  const noun = job.kind === "quiz" ? "quiz" : "lesson";
  return {
    noun,
    startsAt: "the <h1>",
    extract: extractHtml,
    check: job.kind === "quiz" ? checkQuiz : checkLesson,
    accept: (html) => {
      job.html = html;
      job.status = "ready";
      job.log.push(`The ${noun} passed the contract check — saving it.`);
    },
  };
}

// The prompt must satisfy three hard constraints at once:
// 1. It must be the -p ARGUMENT, not stdin — the CLI only expands custom
//    slash commands "in the prompt string"; a piped prompt left /lect
//    unexpanded and Claude exited without generating anything.
// 2. It must be a SINGLE LINE — cmd.exe truncates arguments at newlines.
// 3. It must be QUOTED BY US — spawn with shell:true performs no
//    escaping, so an unquoted multi-word prompt splits into separate
//    argv words. `%` and `"` are stripped because cmd.exe expands/breaks
//    them even inside quotes.
const oneLine = (s: string) => s.replace(/["%\r\n]/g, "");

async function generate(
  job: Job,
  repoRoot: string,
  inputs: string[],
  prompt: string,
  label: string,
  resumeFrom?: string
): Promise<void> {
  const { noun, startsAt, extract, check, accept } = contractFor(job);
  const model = process.env.GENERATE_MODEL || "sonnet";
  let sessionId = resumeFrom;
  try {
    for (let fixes = 0; ; fixes++) {
      // Aborted (or otherwise no longer running) while it sat queued behind
      // an earlier same-folder job, or between rounds — never spawn it.
      if (job.status !== "running") return;
      if (!sessionId) job.log.push(`Job: /${job.kind} → ${job.folder} (${label}) · model ${model}`);

      const run = await runClaude(job, repoRoot, model, prompt, sessionId);
      if (job.status !== "running") return;
      if (!run.ok) {
        explainFailure(job);
        return;
      }

      if (run.sessionId) job.sessionId = run.sessionId;
      const html = extract(run.reply);
      if (!html) {
        job.log.push(`No ${noun} came back — the reply above says why. Nothing was saved.`);
        job.status = "error";
        return;
      }
      const violations = check(html);
      if (!violations.length) {
        accept(html);
        return;
      }

      job.log.push(`Contract check failed: ${violations.join("; ")}`);
      if (fixes >= MAX_FIXES || !run.sessionId) {
        job.log.push(`Still failing after ${fixes} fix attempt(s) — nothing was saved.`);
        job.status = "error";
        return;
      }
      job.log.push(`Asking Claude to fix it (${fixes + 1} of ${MAX_FIXES}).`);
      sessionId = run.sessionId;
      prompt =
        `The app rejected that ${noun} against its output contract: ` +
        oneLine(violations.slice(0, 10).map((v) => v.slice(0, 200)).join("; ")) +
        `. Fix exactly these problems without changing anything else, and reply with only the complete corrected HTML, starting at ${startsAt}.`;
    }
  } finally {
    // The upload is input for this run only — it never outlives it.
    for (const p of inputs) rm(p, { recursive: true, force: true }).catch(() => {});
  }
}

// --- cheatsheets ---------------------------------------------------------------

// The sheet is the one document the reader takes into the room on its own,
// so writing and reviewing both run on Opus 5.5 at high effort, pinned
// by full id so an alias moving to a newer model can't change it silently.
// Both overridable (SHEET_MODEL, SHEET_EFFORT); no fallback — a run on a
// model the reader didn't choose would be worse than one that says why.
const SHEET_MODEL = "claude-opus-5-5";
const SHEET_EFFORT = "high";
// Writing rounds (the first plus fixes) and review passes, each bounded: every
// round re-sends the whole sheet at full effort.
const SHEET_MAX_ROUNDS = 5;
const SHEET_MAX_REVIEWS = 3;

/**
 * Write → check → review → fix, until a sheet passes everything or the rounds
 * run out. Every reply goes through, in order:
 *
 * 1. the contract (checkSheet: tags, attributes, classes, banned wording) and
 *    a coarse length cap;
 * 2. the source check (sources.ts): every chapter present, every number found
 *    in the notes;
 * 3. a review: a separate, fresh session reads the sheet and the same sources
 *    and lists what is wrong, unsupported or missing. Fresh, because the writer
 *    grading its own work finds what it meant to write, not what it wrote.
 *
 * A failure at any step goes back to the writer's session with the list. The
 * last review's findings, if the rounds run out, are shown with the sheet
 * rather than hidden.
 */
async function generateSheet(job: Job, repoRoot: string, firstPrompt: string, label: string): Promise<void> {
  const spec = job.sheet!;
  const run0 = job.sheetRun!;
  const room = LAYOUTS[spec.layout].budget * spec.pages;
  let prompt = firstPrompt;
  let sessionId: string | undefined;
  let reviews = 0;
  job.review = { passes: 0, found: 0, open: [] };
  try {
    for (let round = 0; ; round++) {
      if (job.status !== "running") return;
      if (!sessionId) {
        job.log.push(`Job: /sheet → ${job.folder} (${label}) · model ${run0.model} · effort ${run0.effort}`);
      }
      const run = await runSheetClaude(job, repoRoot, prompt, sessionId);
      if (job.status !== "running") return;
      if (!run.ok) {
        explainFailure(job);
        return;
      }
      if (run.sessionId) job.sessionId = sessionId = run.sessionId;

      const html = extractSheet(run.reply);
      if (!html) {
        job.log.push("No cheatsheet came back — the reply above says why.");
        job.status = "error";
        return;
      }
      // The writer's "NOTE:" line, if it gave one; a fix round usually doesn't,
      // so the first one stands.
      const note = /NOTE:\s*([^\n]+)/i.exec(run.reply.slice(0, run.reply.search(/<h2[\s>]/)))?.[1]?.trim();
      if (note && !job.note) job.note = note.slice(0, 600);

      const sources = sourceIssues(html, run0.sources, run0.extras.length > 0);
      const violations = [...checkSheet(html, spec, run0.sources.map((c) => c.text).join(" ")), ...sources.hard];
      const chars = visibleChars(html);
      if (chars > room * 1.25) {
        violations.push(
          `too long: about ${chars} visible characters for ${spec.pages} page(s), room for about ${room}; ` +
            `cut about ${Math.ceil((1 - room / chars) * 100)} percent`
        );
      }

      let fix: string | null = null;
      if (violations.length) {
        job.log.push(`Checks failed: ${violations.join("; ")}`);
        fix =
          `The app rejected that cheatsheet: ` +
          oneLine(violations.slice(0, 12).map((v) => v.slice(0, 240)).join("; ")) +
          `. Fix exactly these problems, change nothing else, and reply with only the complete corrected fragment, starting at the first <h2>.`;
      } else if (reviews < SHEET_MAX_REVIEWS) {
        reviews++;
        job.log.push(`Checks passed. Review ${reviews}: a fresh session is comparing the sheet with the sources.`);
        const issues = await reviewSheet(job, repoRoot, html, sources.unverified);
        if (job.status !== "running") return;
        job.review.passes = reviews;
        if (issues === null) {
          job.review.open = ["The source review did not finish, so the sheet has not been checked against the notes."];
          job.log.push("The review did not finish; showing the sheet unreviewed.");
        } else if (issues.length) {
          job.review.found += issues.length;
          job.log.push(`Review ${reviews} found ${issues.length} problem(s): ${issues.join("; ")}`);
          if (reviews < SHEET_MAX_REVIEWS && round + 1 < SHEET_MAX_ROUNDS) {
            fix =
              `A reviewer compared the sheet with the source files and found these problems: ` +
              oneLine(issues.slice(0, 20).map((v) => v.slice(0, 300)).join("; ")) +
              `. Fix every one against the sources: correct what is wrong, remove what the sources do not say, add what is missing. ` +
              `Keep everything else as it is, stay within the character budget, and reply with only the complete fragment, starting at the first <h2>.`;
          } else {
            job.review.open = issues;
          }
        } else {
          job.log.push(`Review ${reviews} found nothing to fix.`);
        }
      }

      if (!fix) {
        job.html = html;
        job.status = "ready";
        job.log.push(
          job.review.open.length
            ? `The cheatsheet passed the checks with ${job.review.open.length} open point(s) from the review — saving it.`
            : "The cheatsheet passed every check and the review — saving it."
        );
        return;
      }
      if (round + 1 >= SHEET_MAX_ROUNDS) {
        job.log.push(`Still failing after ${round + 1} round(s) — giving up.`);
        job.status = "error";
        return;
      }
      job.log.push(`Asking Claude to fix it (round ${round + 2} of ${SHEET_MAX_ROUNDS}).`);
      prompt = fix;
    }
  } finally {
    // The sheet is saved from here on; an edit reads its sources afresh.
    if (job.status !== "running") rm(run0.dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** One writing round for a sheet, on the sheet's model and effort. */
function runSheetClaude(job: Job, repoRoot: string, prompt: string, resume?: string): Promise<RunResult> {
  const r = job.sheetRun!;
  return runClaude(job, repoRoot, r.model, prompt, resume, r.effort);
}

/**
 * The independent review: a fresh session (never the writer's) reads the
 * sheet and its sources and returns a list of problems as JSON. null when the
 * review itself failed or answered in a shape that can't be read.
 */
async function reviewSheet(
  job: Job,
  repoRoot: string,
  html: string,
  unverified: string[]
): Promise<string[] | null> {
  const r = job.sheetRun!;
  const spec = job.sheet!;
  const file = `${r.dir}/sheet-under-review.html`;
  await writeFile(file, html.replace(/(<(?:h2|h3|p|li|tr|table|ul|ol|pre|svg)[\s>])/g, "\n$1"));
  const prompt =
    `/sheet Review mode. Do not create, write or edit any file. ` +
    `The cheatsheet to review is at ${oneLine(file)}. Its only sources are the chapter files ${r.chapters.map((c) => oneLine(c.path)).join(", ")}` +
    (r.extras.length ? ` and the slides ${r.extras.map(oneLine).join(", ")} (convert them with the markitdown tool)` : "") +
    `. It covers chapters ${spec.from} to ${spec.to} within a ${spec.pages}-page limit. ` +
    (unverified.length
      ? `These numbers on the sheet are not in the chapter notes, so confirm each against the slides: ${unverified.slice(0, 30).join(", ")}. `
      : "") +
    `Follow the review section of the /sheet command. Reply with only a JSON object and nothing else, of the form {"issues":[{"kind":"wrong|unsupported|missing|unclear","where":"a short exact quote from the sheet, or the chapter heading","fix":"what the sources say, with the chapter"}]}. An empty list means the sheet is correct and complete.`;

  const run = await runClaude(job, repoRoot, r.model, prompt, undefined, r.effort);
  if (!run.ok) return null;
  const a = run.reply.indexOf("{");
  const b = run.reply.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try {
    const parsed = JSON.parse(run.reply.slice(a, b + 1));
    if (!Array.isArray(parsed?.issues)) return null;
    return parsed.issues
      .filter((i: any) => i && typeof i === "object")
      .map((i: any) => `${String(i.kind ?? "issue")}: "${String(i.where ?? "").slice(0, 160)}" → ${String(i.fix ?? "").slice(0, 300)}`);
  } catch {
    return null;
  }
}

interface RunResult {
  ok: boolean;
  /** the final reply text — where the document is */
  reply: string;
  sessionId?: string;
}

function runClaude(
  job: Job,
  repoRoot: string,
  model: string,
  prompt: string,
  resume: string | undefined,
  effort?: string
): Promise<RunResult> {
  return new Promise((resolveRun) => {
    const bin = process.env.CLAUDE_BIN || "claude";
    const useShell = process.platform === "win32"; // the CLI is a .cmd shim on Windows
    const args = [
      "-p", useShell ? `"${prompt}"` : prompt,
      "--model", model,
      "--output-format", "stream-json",
      "--verbose",
      "--tools", "Read",
      "--allowedTools", ALLOWED_TOOLS,
      "--permission-mode", "dontAsk",
    ];
    if (resume) args.push("--resume", resume);
    if (effort) args.push("--effort", effort);
    const child = spawn(bin, args, { cwd: repoRoot, shell: useShell, stdio: ["ignore", "pipe", "pipe"] });

    let buf = "";
    // Success requires claude's own final `result` event, not just exit code
    // 0 — a run that never engaged (bad prompt expansion, wrong cwd, CLI
    // printing plain text instead of stream-json) exits 0 without one, and
    // that must surface as a failure, not a false "finished".
    let sawResult = false;
    let resultFailed = false;
    let reply = "";
    let sessionId: string | undefined;
    // Earlier rounds' totals — a fix round is a separate CLI run whose result
    // event only counts itself.
    const before = { ...job.tokens };
    // eslint-disable-next-line no-control-regex
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    const onLine = (line: string) => {
      line = stripAnsi(line);
      if (!line.trim()) return;
      try {
        const ev = JSON.parse(line);
        if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
          // per-message usage accumulates across the agent loop's API calls
          if (ev.message.usage) {
            job.tokens.input += ev.message.usage.input_tokens ?? 0;
            job.tokens.output += ev.message.usage.output_tokens ?? 0;
          }
          for (const block of ev.message.content) {
            if (block.type === "text" && block.text?.trim()) {
              // The document itself is the reply, not a log line.
              job.log.push(/<h[12][\s>]/.test(block.text) ? "Received the generated HTML." : block.text.trim());
            } else if (block.type === "tool_use") {
              job.log.push(`→ ${block.name}`);
            }
          }
        } else if (ev.type === "result") {
          sawResult = true;
          resultFailed = !!ev.is_error;
          reply = typeof ev.result === "string" ? ev.result : "";
          sessionId = ev.session_id;
          // the result event carries authoritative totals for this round — overwrite
          if (ev.usage) {
            job.tokens.input = before.input + (ev.usage.input_tokens ?? 0);
            job.tokens.output = before.output + (ev.usage.output_tokens ?? 0);
          }
          if (ev.is_error) job.log.push(`Failed: ${ev.result ?? "unknown error"}`);
        }
      } catch {
        job.log.push(line.trim());
      }
    };

    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        onLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      const line = stripAnsi(d.toString()).trim();
      if (line) job.log.push(line);
    });
    child.on("error", (err) => {
      // The common cause is not a broken install but the wrong machine: a
      // server has no CLI because a subscription authenticates where its owner
      // is. Say that, rather than only "install it". The raw spawn error (local
      // binary path, errno) goes to the server log only — this job's log is
      // readable by whoever started it, but nothing else about this machine
      // needs to travel with it.
      if (!err.message.includes("ENOENT")) console.error("[generate] spawn error:", err.message);
      job.log.push(
        err.message.includes("ENOENT")
          ? "Claude Code CLI not found — generation runs on your own Claude subscription, " +
            "so it needs `claude` installed and signed in on this machine. On a server there is none: " +
            "generate from the desktop app instead."
          : "Generation failed to start — check the server logs."
      );
      job.status = "error";
      job.child = undefined;
      resolveRun({ ok: false, reply: "" });
    });
    child.on("close", (code) => {
      job.child = undefined;
      if (job.status !== "running") {
        resolveRun({ ok: false, reply: "" });
        return;
      }
      if (code !== 0) job.log.push(`claude exited with code ${code}`);
      else if (!sawResult) {
        job.log.push(
          "claude exited without completing the command — no result was produced, so nothing was generated. " +
            "The output above shows what it did instead."
        );
      }
      resolveRun({ ok: code === 0 && sawResult && !resultFailed, reply, sessionId });
    });

    job.child = child;
  });
}

// Classify a failed run so the user knows whether to just retry.
function explainFailure(job: Job) {
  if (job.status !== "running") return; // spawn error — already explained
  job.status = "error";
  const text = job.log.join("\n").toLowerCase();
  if (/oauth|authenticate|unauthorized|not logged in|log ?in|session expired|401/.test(text)) {
    job.needsAuth = true;
    job.log.push(
      "→ Claude Code isn't signed in (the session expired). Nothing was saved — sign in and generate again."
    );
  } else if (/rate.?limit|usage limit|quota|out of|credit|insufficient|max.*tokens|token budget|429/.test(text)) {
    job.log.push(
      "→ This looks like a Claude usage/rate limit. Wait a bit (or check your plan's limits), then click Generate again."
    );
  } else if (/connection closed|api error|overloaded|econnreset|etimedout|network|socket hang up|502|503|529/.test(text)) {
    job.log.push(
      "→ This looks like a transient Claude API/network drop, not a problem with your file. Nothing was saved — click Generate again to retry."
    );
  }
}

/**
 * Saves a ready job's document to Supabase. Called from a request
 * (POST /api/generate/[id]) rather than when the run ends, because the save
 * runs as the signed-in user under RLS and only a request carries their
 * session — the run itself outlives the request that started it. Safe to call
 * twice: a save in flight is shared, a finished one is returned as-is.
 */
export function saveJob(job: Job): Promise<SavedDoc> {
  if (job.saved) return Promise.resolve(job.saved);
  if (job.saving) return job.saving;
  if (job.status !== "ready" || !job.html) return Promise.reject(new Error("nothing to save"));

  const noun = job.kind === "quiz" ? "quiz" : job.kind === "sheet" ? "cheatsheet" : "lesson";
  const saving =
    job.kind === "sheet" ? saveSheetJob(job, job.html) : saveGenerated(job.folder, job.kind, job.html);
  job.saving = saving
    .then((saved) => {
      job.saved = saved;
      job.html = undefined;
      job.status = "done";
      job.log.push(`Saved ${noun} "${saved.title}" to ${job.folder}.`, "Finished.");
      return saved;
    })
    .catch((err: Error) => {
      // Stays "ready" with the document still held, so a retry — or the
      // client re-attaching after a reload — can save it again.
      job.log.push(`Save failed: ${err.message}`);
      throw err;
    })
    .finally(() => {
      job.saving = undefined;
    });
  return job.saving;
}

function saveSheetJob(job: Job, html: string): Promise<SavedDoc> {
  const at = new Date().toISOString();
  const spec = job.sheet!;
  const said =
    job.note ||
    (job.edit ? "Done." : `Made the sheet for chapters ${spec.from} to ${spec.to} on ${spec.pages} page(s).`);
  const turns: SheetMessage[] = [
    ...(job.edit ? [{ role: "user" as const, text: job.edit.request, at: new Date(job.startedAt).toISOString() }] : []),
    { role: "assistant", text: said, at },
  ];
  return saveSheet(job.folder, html, spec, job.review ?? null, turns, job.edit?.docKey);
}

// stopJob force-kills a running job (the UI's Ctrl+C). shell:true means
// the direct child is a cmd.exe shim, so the whole tree must go —
// taskkill /T on Windows, plain kill elsewhere.
export function stopJob(id: string, userId: string): boolean {
  const job = getJob(id, userId);
  if (!job || job.status !== "running") return false;
  job.status = "aborted";
  job.log.push("^C — aborted by user.");
  if (job.child?.pid) {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(job.child.pid), "/T", "/F"], { windowsHide: true });
    } else {
      job.child.kill("SIGTERM");
    }
    job.child = undefined;
  }
  // Else: still queued behind another run in the same folder — generate()'s
  // own status check skips spawning it once its turn comes, so there is no
  // process to kill yet, just the queue slot to give up.
  return true;
}
