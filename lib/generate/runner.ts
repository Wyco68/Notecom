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
import { createHash, randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { rm, writeFile } from "fs/promises";
import path from "path";
import { checkLesson, checkQuiz, extractHtml } from "./validate";
import { saveGenerated, savePictures, type SavedDoc } from "./save";
import { extractSlideImages, imageIndex, IMAGE_EXT, type SlideImage } from "./media";
import { placePictures, parsePlacements } from "./place";
import type { SheetSpec } from "../sheet/layout";

export type JobKind = "lect" | "quiz" | "sheet";

export interface Job {
  id: string;
  /** "ready": generated and contract-checked, waiting for the save request
   *  (see saveJob) — the one step that needs the caller's session. */
  status: "running" | "ready" | "done" | "error" | "aborted";
  folder: string;
  kind: JobKind;
  /** set on cheatsheet runs only (lib/generate/sheet.ts) */
  sheet?: SheetSpec;
  /** which cheatsheet step: writing chapters, an edit, or the review */
  step?: "write" | "edit" | "review";
  /** the stored sheet a step works on, once there is one, and for an edit the
   *  reader's message — shown in the sheet's conversation while it runs */
  edit?: { docKey: string; request: string };
  /** a sheet step's own state; server-side only, never listed */
  task?: unknown;
  /** the slide pictures offered to the run, by the name it uses for them */
  offered?: Map<string, SlideImage>;
  /** how a "ready" job is saved, when not the lesson/quiz way. May leave the
   *  job running again, for a step that saves as it goes (continued: true). */
  onSave?: () => Promise<SavedDoc & { continued?: boolean }>;
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
  /** the slide pictures the document uses, read out of the run's temp dir
   *  before it is deleted; uploaded with the document on save */
  pictures?: Map<string, Picture>;
  /** set on a run that adds slide pictures to a lesson already saved: the
   *  reply is a list of placements, not a lesson (see ./place.ts) */
  target?: { docKey: string; title: string; html: string };
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

/** This caller's unfinished cheatsheet step on one sheet, if any: a sheet
 *  takes one step at a time, so two versions never race to be saved. */
export function activeSheetStep(userId: string, folder: string, docKey: string): Job | undefined {
  return [...jobs.values()].find(
    (j) =>
      j.startedBy === userId &&
      j.kind === "sheet" &&
      j.folder === folder &&
      j.edit?.docKey === docKey &&
      (j.status === "running" || j.status === "ready")
  );
}

/** Adds a job started elsewhere (lib/generate/sheet.ts) to the list. */
export function registerJob(job: Job): void {
  jobs.set(job.id, job);
}

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
  Pick<Job, "id" | "status" | "folder" | "kind" | "sheet" | "step" | "edit" | "startedAt" | "tokens" | "needsAuth" | "saved">
> {
  // Picked, not spread: a job carries server-side state (temp paths, source
  // text, the CLI session) that has no business leaving this process.
  return [...jobs.values()]
    .filter((j) => j.startedBy === userId)
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(({ id, status, folder, kind, sheet, step, edit, startedAt, tokens, needsAuth, saved }) => ({
      id, status, folder, kind, sheet, step, edit, startedAt, tokens, needsAuth, saved,
    }));
}

export interface Picture {
  data: Buffer;
  ext: string;
  width: number;
  height: number;
}

export function startJob(
  folder: string,
  kind: "lect" | "quiz",
  filePath: string,
  originalName: string,
  startedBy: string,
  /** add pictures to this saved lesson instead of writing a new one */
  target?: Job["target"]
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
    target,
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
  const mediaDir = `${filePath}.media`;
  const inputs = [filePath, mediaDir];

  // The pictures are pulled out before the run, so the prompt can say where
  // they are; a quiz has no use for them.
  const prepare = async (): Promise<string> => {
    if (kind === "quiz") return prompt;
    let images = await extractSlideImages(filePath, mediaDir);
    if (target) {
      // A stored picture is named by its content's hash, so one the lesson
      // already shows is known exactly — and not offered again.
      const shown = new Set([...target.html.matchAll(/\/api\/media\/[0-9a-f-]{36}\/([0-9a-f]{64})\./g)].map((m) => m[1]));
      images = images.filter((i) => !shown.has(createHash("sha256").update(readFileSync(i.path)).digest("hex")));
    }
    job.offered = new Map(images.map((i) => [i.name, i]));
    const index = path.join(mediaDir, "pictures.txt");
    await writeFile(index, imageIndex(images) + "\n");
    if (images.length) job.log.push(`Found ${images.length} slide picture(s) the ${noun} can use.`);
    if (target) {
      const lessonFile = path.join(mediaDir, "lesson.html");
      await writeFile(lessonFile, blockPerLine(target.html));
      return (
        `/lect Picture mode: add slide pictures to a lesson that is already saved — do not rewrite it, and do not create, write or edit any file. ` +
        `The lesson is at ${lessonFile}. The slides it was written from are at ${filePath} (original name: ${safeOriginal}); convert them with the markitdown tool to see what each slide says. ` +
        (images.length
          ? `The pictures taken from those slides are in ${mediaDir}, and ${index} lists each with its slide number and size. `
          : `The slides have no pictures to add, so reply with an empty JSON array. `) +
        `Follow the /lect command's Picture mode and its slide-picture rules exactly. ` +
        `Reply with only the JSON array of placements — no code fence and no text before or after it.`
      );
    }
    return (
      prompt +
      (images.length
        ? ` The pictures taken from the upload are in ${mediaDir}, and ${index} lists each with its slide number and size; place the ones the lesson needs by file name, following the /lect command's slide-picture rules.`
        : ` The upload has no pictures to place.`)
    );
  };

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
  const thisRun = priorInFolder.then(async () => {
    if (job.status !== "running") return;
    let first: string;
    try {
      first = await prepare();
    } catch {
      // A picture step that fails costs the lesson its pictures, not the run.
      first = prompt;
    }
    return generate(job, repoRoot, inputs, first, safeOriginal);
  });
  folderChains.set(folder, thisRun.catch(() => {}));

  return job;
}

// Without the command file, claude "succeeds" with a confused one-turn reply
// and no document — fail fast and say why.
export function commandReady(job: Job, repoRoot: string, inputs: string[]): boolean {
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
  const offered = job.offered ?? new Map<string, SlideImage>();
  const names = new Set(offered.keys());
  // Read now: the temp dir goes when the run ends, and the save comes after.
  const keep = (html: string) => {
    const used = new Map<string, Picture>();
    for (const m of html.matchAll(/<img\s[^>]*\bsrc="([^"]+)"/g)) {
      const img = offered.get(m[1]);
      if (img && !used.has(img.name)) {
        used.set(img.name, { data: readFileSync(img.path), ext: IMAGE_EXT[img.mime], width: img.width, height: img.height });
      }
    }
    return used;
  };

  if (job.target) {
    const target = job.target;
    // A placement that can't be applied comes back as a violation, through
    // the same fix round as a lesson that breaks the contract.
    let placed = "";
    return {
      noun: "list of picture placements",
      startsAt: "the [",
      extract: (reply) => {
        const parsed = parsePlacements(reply);
        if (!parsed) return null;
        const { html, errors } = placePictures(target.html, parsed, names);
        placed = errors.length ? "" : html;
        // The fix prompt quotes `check`, so errors travel through it.
        return JSON.stringify({ errors, count: parsed.length });
      },
      check: (out) => {
        const { errors } = JSON.parse(out) as { errors: string[] };
        return errors.length ? errors : checkLesson(placed, names);
      },
      accept: (out) => {
        const { count } = JSON.parse(out) as { count: number };
        job.html = placed;
        job.pictures = keep(placed);
        job.status = "ready";
        job.log.push(
          count ? `Placed ${count} picture(s) — saving the lesson.` : "No picture was worth adding — the lesson stays as it was."
        );
      },
    };
  }

  return {
    noun,
    startsAt: "the <h1>",
    extract: extractHtml,
    check: job.kind === "quiz" ? checkQuiz : (html) => checkLesson(html, names),
    accept: (html) => {
      job.html = html;
      job.pictures = keep(html);
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
export const oneLine = (s: string) => s.replace(/["%\r\n]/g, "");

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
        (job.target
          ? `. Fix exactly these problems and reply with only the complete corrected JSON array of placements.`
          : `. Fix exactly these problems without changing anything else, and reply with only the complete corrected HTML, starting at ${startsAt}.`);
    }
  } finally {
    // The upload is input for this run only — it never outlives it.
    for (const p of inputs) rm(p, { recursive: true, force: true }).catch(() => {});
  }
}

export interface RunResult {
  ok: boolean;
  /** the final reply text — where the document is */
  reply: string;
  sessionId?: string;
}

export function runClaude(
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
export function explainFailure(job: Job) {
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
export function saveJob(job: Job): Promise<SavedDoc & { continued?: boolean }> {
  if (job.saving) return job.saving;
  // A step with its own save (a cheatsheet): it may save several times, each
  // one leaving the job running again until the last.
  if (job.onSave) {
    if (job.status !== "ready") {
      return job.saved && job.status === "done" ? Promise.resolve(job.saved) : Promise.reject(new Error("nothing to save"));
    }
    const pending = job.onSave()
      .then((saved) => {
        job.saved = { id: saved.id, title: saved.title };
        return saved;
      })
      .catch((err: Error) => {
        // Stays "ready" with the work still held, so a retry can save it.
        job.log.push(`Save failed: ${err.message}`);
        throw err;
      })
      .finally(() => {
        job.saving = undefined;
      });
    job.saving = pending;
    return pending;
  }
  if (job.saved) return Promise.resolve(job.saved);
  if (job.status !== "ready" || !job.html || job.kind === "sheet") {
    return Promise.reject(new Error("nothing to save"));
  }

  const noun = job.kind === "quiz" ? "quiz" : "lesson";
  const pictures = job.pictures ?? new Map();
  job.saving = (
    job.target
      ? savePictures(job.folder, job.target.docKey, job.html, pictures)
      : saveGenerated(job.folder, job.kind, job.html, pictures)
  )
    .then((saved) => {
      job.saved = saved;
      job.html = undefined;
      job.pictures = undefined;
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

// One block per line: Read cuts very long lines, and a lesson is often stored
// as one.
function blockPerLine(html: string): string {
  return html.replace(/(<(?:h[1-6]|p|li|tr|table|ul|ol|pre|blockquote|div|figure)[\s>])/g, "\n$1");
}
