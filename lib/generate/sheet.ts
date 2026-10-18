// Cheatsheet runs, in steps that save as they go.
//
// A sheet used to be one long run — write everything, check, review, fix —
// and a usage limit hit near the end threw all of it away. Now the work is
// cut into steps the reader drives from the sheet's view, and every step saves
// what it has before the next costs anything:
//
//   write   one chapter per CLI run; the sheet is saved after each, so a run
//           that stops at chapter 5 keeps 1-4 and "Continue writing" picks up
//           at 5. The first save creates the sheet; Save PDF works from then.
//   edit    one run over the whole sheet: a chat message, "fix these checks",
//           "fix the review findings", or new sources folded in.
//   review  a fresh session checks one chapter's section against its sources
//           per run; each chapter's findings are saved as they come.
//
// Saving needs the reader's session (RLS), which only a request carries, so a
// step that wants to save goes "ready" and waits; the client's
// POST /api/generate/[id] saves it (onSave) and, if there is more to do, sets
// it running again and the client follows on. A step only ever saves markup
// that passes the safety half of the contract (sheetMarkupIssues); everything
// else the app checks — wording, numbers, length — is saved alongside as
// open checks and shown, never a reason to lose the work.

import { randomUUID } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { rm, writeFile } from "fs/promises";
import path from "path";
import {
  commandReady,
  explainFailure,
  oneLine,
  registerJob,
  runClaude,
  type Job,
  type RunResult,
} from "./runner";
import { checkSheet, extractSheet, sheetMarkupIssues } from "./validate";
import { saveSheetVersion } from "./save";
import {
  LAYOUTS,
  layoutLabel,
  pageLimitText,
  reviewOf,
  visibleChars,
  type SheetMessage,
  type SheetMeta,
  type SheetSpec,
  type SourceRef,
} from "../sheet/layout";
import { plainText, sourceIssues } from "../sheet/sources";
import type { SheetInputs } from "../sheet/inputs";

// The sheet is the one document the reader takes into the room on its own,
// so writing and reviewing run on Opus 5.5, pinned by full id so an alias
// moving to a newer model can't change it silently. Both overridable.
const SHEET_MODEL = "claude-opus-5-5";
const SHEET_EFFORT = "high";
// Fix rounds per run, after the first reply. Bounded: each re-sends the work.
const MAX_FIX_ROUNDS = 2;

interface Task {
  dir: string;
  chapters: Array<{ seq: number; path: string; text: string }>;
  /** added documents (quizzes, other lessons), with their text */
  docs: Array<{ ref: SourceRef; path: string; text: string }>;
  /** uploaded files (slides): read by the CLI, not by the app */
  uploads: string[];
  model: string;
  effort: string;
  /** the stored sheet, once the first save has made one */
  docKey?: string;
  /** the sheet as it stands in this step */
  html: string;
  /** what waits for the client's save, and how to wake the step after it */
  waiting?: { html: string | null; update: (m: SheetMeta) => SheetMeta; last: boolean; done: string };
  wake?: (saved: boolean) => void;
}

// --- starting a step ----------------------------------------------------------

function newSheetJob(
  folder: string,
  spec: SheetSpec,
  step: Job["step"],
  userId: string,
  inputs: SheetInputs,
  uploads: string[],
  current: { docKey?: string; html: string; request?: string }
): { job: Job; task: Task } {
  const task: Task = {
    dir: inputs.dir,
    chapters: inputs.chapters.map((c) => ({ ...c, text: plainText(readFileSync(c.path, "utf8")) })),
    docs: inputs.docs.map((d) => ({ ...d, text: plainText(readFileSync(d.path, "utf8")) })),
    uploads,
    model: process.env.SHEET_MODEL || SHEET_MODEL,
    effort: process.env.SHEET_EFFORT || SHEET_EFFORT,
    docKey: current.docKey,
    html: current.html,
  };
  const job: Job = {
    id: randomUUID(),
    status: "running",
    folder,
    kind: "sheet",
    sheet: spec,
    step,
    edit: current.docKey ? { docKey: current.docKey, request: current.request ?? "" } : undefined,
    task,
    log: [],
    startedAt: Date.now(),
    tokens: { input: 0, output: 0 },
    startedBy: userId,
  };
  job.onSave = () => saveWaiting(job, task);
  registerJob(job);
  return { job, task };
}

/** Writes chapters `order` (all of them for a new sheet, the rest for a continue). */
export function startSheetWrite(input: {
  folder: string;
  spec: SheetSpec;
  inputs: SheetInputs;
  uploads: string[];
  userId: string;
  order: number[];
  docKey?: string;
  html?: string;
}): Job {
  const { job, task } = newSheetJob(input.folder, input.spec, "write", input.userId, input.inputs, input.uploads, {
    docKey: input.docKey,
    html: input.html ?? "",
  });
  const repoRoot = process.env.REPO_ROOT || process.cwd();
  if (commandReady(job, repoRoot, [task.dir])) writeLoop(job, task, input.order, repoRoot);
  return job;
}

/** One change to a stored sheet, from the reader's words. `addRefs` and
 *  uploads are new sources to fold in; refs are kept with the sheet. */
export function startSheetEdit(input: {
  folder: string;
  spec: SheetSpec;
  inputs: SheetInputs;
  uploads: string[];
  userId: string;
  docKey: string;
  html: string;
  request: string;
  history: SheetMessage[];
  addRefs?: SourceRef[];
}): Job {
  const { job, task } = newSheetJob(input.folder, input.spec, "edit", input.userId, input.inputs, input.uploads, {
    docKey: input.docKey,
    html: input.html,
    request: input.request,
  });
  const repoRoot = process.env.REPO_ROOT || process.cwd();
  if (commandReady(job, repoRoot, [task.dir])) {
    editOnce(job, task, input.request, input.history, input.addRefs ?? [], repoRoot);
  }
  return job;
}

/** Reviews chapters `order` of a stored sheet, one per run. */
export function startSheetReview(input: {
  folder: string;
  spec: SheetSpec;
  inputs: SheetInputs;
  userId: string;
  docKey: string;
  html: string;
  order: number[];
}): Job {
  const { job, task } = newSheetJob(input.folder, input.spec, "review", input.userId, input.inputs, [], {
    docKey: input.docKey,
    html: input.html,
  });
  const repoRoot = process.env.REPO_ROOT || process.cwd();
  if (commandReady(job, repoRoot, [task.dir])) reviewLoop(job, task, input.order, repoRoot);
  return job;
}

// --- saving -------------------------------------------------------------------

/** Parks the step until the client saves; resolves false if it never may. */
function awaitSave(job: Job, task: Task, waiting: NonNullable<Task["waiting"]>): Promise<boolean> {
  task.waiting = waiting;
  job.status = "ready";
  return new Promise((resolve) => {
    task.wake = resolve;
  });
}

async function saveWaiting(job: Job, task: Task) {
  const w = task.waiting;
  if (!w) throw new Error("nothing to save");
  const saved = await saveSheetVersion(job.folder, task.docKey, w.html, job.sheet!, w.update);
  task.docKey = saved.id;
  job.edit = { docKey: saved.id, request: job.edit?.request ?? "" };
  task.waiting = undefined;
  job.log.push(w.done);
  const wake = task.wake;
  task.wake = undefined;
  if (w.last) {
    job.status = "done";
    job.log.push("Finished.");
    wake?.(true);
    return saved;
  }
  job.status = "running";
  wake?.(true);
  return { ...saved, continued: true };
}

function cleanup(job: Job, task: Task) {
  if (job.status !== "running" && job.status !== "ready") rm(task.dir, { recursive: true, force: true }).catch(() => {});
}

// --- checks -------------------------------------------------------------------

/** What the app's own checks say about a whole sheet, saved with it. */
function sheetChecks(spec: SheetSpec, task: Task, html: string, unwritten: number[] = []): string[] {
  const allText = [...task.chapters.map((c) => c.text), ...task.docs.map((d) => d.text)].join(" ");
  const written = task.chapters.filter((c) => !unwritten.includes(c.seq));
  const issues = [
    ...checkSheet(html, spec, allText),
    ...sourceIssues(
      html,
      written.map((c) => ({ seq: c.seq, text: c.text })),
      task.uploads.length > 0,
      task.docs.map((d) => d.text)
    ).hard,
  ];
  if (spec.pages) {
    const room = LAYOUTS[spec.layout].budget * spec.pages;
    const chars = visibleChars(html);
    if (chars > room * 1.25) {
      issues.push(`too long: about ${chars} visible characters for ${pageLimitText(spec.pages)}, room for about ${room}`);
    }
  }
  return issues;
}

// --- sections -----------------------------------------------------------------

/** A sheet's chapter sections, by chapter number, each from its <h2> on. */
export function sectionsOf(html: string): Map<number, string> {
  const out = new Map<number, string>();
  const starts = [...html.matchAll(/<h2[\s>]/g)].map((m) => m.index!);
  starts.forEach((start, i) => {
    const part = html.slice(start, starts[i + 1] ?? html.length).trim();
    const seq = Number(/^<h2[^>]*>\s*(?:<[^>]+>\s*)*(\d+)\./.exec(part)?.[1]);
    if (seq) out.set(seq, part);
  });
  return out;
}

function withSection(html: string, seq: number, section: string): string {
  const parts = sectionsOf(html);
  parts.set(seq, section.trim());
  return [...parts.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s).join("\n");
}

/** Chapters whose section reads differently — whitespace between tags, which
 *  a writer reflows freely, doesn't count. */
function changedSections(before: string, after: string): number[] {
  const norm = (s?: string) => (s ?? "").replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();
  const a = sectionsOf(before);
  const b = sectionsOf(after);
  return [...new Set([...a.keys(), ...b.keys()])].filter((k) => norm(a.get(k)) !== norm(b.get(k)));
}

// --- prompts ------------------------------------------------------------------

function sourcesLine(task: Task, only?: number): string {
  const docs = task.docs.map((d) => `${oneLine(d.path)} (${d.ref.kind}: ${oneLine(d.ref.title)})`);
  const uploads = task.uploads.map(oneLine);
  const more = [...docs, ...uploads];
  return (
    (more.length
      ? `Other sources: ${more.join(", ")}${uploads.length ? "; convert non-HTML files with the markitdown tool" : ""}` +
        (only ? `; use only what belongs to chapter ${only}. ` : `. `)
      : "") + `Ground every fact strictly in these files; if a file cannot be read, stop and say so instead of guessing. `
  );
}

function paperLine(spec: SheetSpec, budget?: number): string {
  const L = LAYOUTS[spec.layout];
  return spec.pages
    ? `Page limit ${pageLimitText(spec.pages)}, ${layoutLabel(spec)}, about ${L.font}pt` +
        (budget ? `; character budget for this part: about ${budget.toLocaleString("en-US")} visible characters, whitespace excluded, aim for 90 to 100 percent of it. ` : `. `)
    : `No page limit, ${layoutLabel(spec)}: cover every fact in full, as many pages as it takes, still in the compressed note style and without padding. `;
}

function sheetNote(reply: string): string | undefined {
  const head = reply.slice(0, Math.max(0, reply.search(/<h2[\s>]/)));
  return /NOTE:\s*([^\n]+)/i.exec(head)?.[1]?.trim().slice(0, 600);
}

function runSheet(job: Job, task: Task, repoRoot: string, prompt: string, resume?: string): Promise<RunResult> {
  return runClaude(job, repoRoot, task.model, prompt, resume, task.effort);
}

/**
 * Write → check → fix, within one run's session. Returns the last reply that
 * passes the markup check, with whatever else is still open, or null when the
 * run failed or never produced safe markup.
 */
async function writeChecked(
  job: Job,
  task: Task,
  repoRoot: string,
  prompt: string,
  check: (html: string) => string[]
): Promise<{ html: string; note?: string; open: string[] } | null> {
  let session: string | undefined;
  let note: string | undefined;
  for (let round = 0; ; round++) {
    if (job.status !== "running") return null;
    const run = await runSheet(job, task, repoRoot, prompt, session);
    if (job.status !== "running") return null;
    if (!run.ok) {
      explainFailure(job);
      return null;
    }
    session = run.sessionId ?? session;
    note = note ?? sheetNote(run.reply);
    const html = extractSheet(run.reply);
    if (!html) {
      job.log.push("No cheatsheet came back — the reply above says why.");
      job.status = "error";
      return null;
    }
    const open = check(html);
    const unsafe = sheetMarkupIssues(html);
    if (!open.length) return { html, note, open };
    job.log.push(`Checks: ${open.join("; ")}`);
    if (round >= MAX_FIX_ROUNDS || !session) {
      if (unsafe.length) {
        job.log.push("The markup still breaks the allowlist, so nothing of this part is saved.");
        job.status = "error";
        return null;
      }
      job.log.push(`Saving it with ${open.length} open check(s) — they are listed with the sheet.`);
      return { html, note, open };
    }
    job.log.push(`Asking Claude to fix it (round ${round + 2} of ${MAX_FIX_ROUNDS + 1}).`);
    prompt =
      `The app found these problems: ` +
      oneLine(open.slice(0, 12).map((v) => v.slice(0, 240)).join("; ")) +
      `. Fix exactly these, change nothing else, and reply with one NOTE: line and the complete corrected fragment, starting at the first <h2>.`;
  }
}

// --- write: one chapter per run ---------------------------------------------------

async function writeLoop(job: Job, task: Task, order: number[], repoRoot: string): Promise<void> {
  const spec = job.sheet!;
  const L = LAYOUTS[spec.layout];
  const totalText = task.chapters.reduce((n, c) => n + c.text.length, 0) || 1;
  const notes: string[] = [];
  job.log.push(
    `Job: /sheet → ${job.folder} (chapters ${spec.from}-${spec.to}, ${pageLimitText(spec.pages)}) · ${order.length} chapter(s) to write · model ${task.model} · effort ${task.effort}`
  );
  try {
    for (let i = 0; i < order.length; i++) {
      const seq = order[i];
      const ch = task.chapters.find((c) => c.seq === seq);
      if (!ch) continue;
      const budget = spec.pages ? Math.round((L.budget * spec.pages * ch.text.length) / totalText) : undefined;
      job.log.push(`Writing chapter ${seq} (${i + 1} of ${order.length}).`);
      const prompt =
        `/sheet Chapter mode. Do not create, write or edit any file; you only have read access. ` +
        `This is one part of a cheatsheet covering chapters ${spec.from} to ${spec.to}; the other chapters are written separately. ` +
        `Write only the section for chapter ${seq}, from its chapter file ${oneLine(ch.path)}. ` +
        sourcesLine(task, seq) +
        paperLine(spec, budget) +
        `Reply with one line starting "NOTE:" that tells the reader in plain words what this chapter covers or had to leave out, then the section, starting at <h2>${seq}. …</h2>, with no other <h2>.`;
      const part = await writeChecked(job, task, repoRoot, prompt, (html) => {
        const issues = [
          ...checkSheet(html, { from: seq, to: seq }, [ch.text, ...task.docs.map((d) => d.text)].join(" ")),
          ...sourceIssues(html, [{ seq, text: ch.text }], task.uploads.length > 0, task.docs.map((d) => d.text)).hard,
        ];
        if (budget) {
          const chars = visibleChars(html);
          if (chars > budget * 1.3) {
            issues.push(`too long for its share: about ${chars} visible characters, room for about ${budget}; cut about ${Math.ceil((1 - budget / chars) * 100)} percent`);
          }
        }
        return issues;
      });
      if (!part) {
        if (job.status === "running") job.status = "error";
        job.log.push(
          i > 0 || task.docKey
            ? `Stopped at chapter ${seq}. What was written before it is saved — use Continue writing on the sheet.`
            : `Stopped at chapter ${seq}; nothing was saved yet.`
        );
        return;
      }
      if (part.note) notes.push(`Chapter ${seq}: ${part.note}`);
      task.html = withSection(task.html, seq, part.html);
      const rest = order.slice(i + 1);
      const last = rest.length === 0;
      const html = task.html;
      const ok = await awaitSave(job, task, {
        html,
        last,
        done: `Saved chapter ${seq}${rest.length ? `; ${rest.length} to go` : ""}.`,
        update: (m) => {
          const review = reviewOf(m);
          return {
            ...m,
            spec,
            pending: rest,
            checks: sheetChecks(spec, task, html, rest),
            review: { reviewed: review.reviewed.filter((n) => n !== seq), issues: { ...review.issues, [seq]: [] } },
            messages: last
              ? [
                  ...m.messages,
                  {
                    role: "assistant",
                    text: notes.length ? notes.join("\n") : `Wrote chapters ${spec.from} to ${spec.to}.`,
                    at: new Date().toISOString(),
                  },
                ]
              : m.messages,
          };
        },
      });
      if (!ok) return;
    }
  } finally {
    cleanup(job, task);
  }
}

// --- edit: one run over the whole sheet ---------------------------------------------

async function editOnce(
  job: Job,
  task: Task,
  request: string,
  history: SheetMessage[],
  addRefs: SourceRef[],
  repoRoot: string
): Promise<void> {
  const spec = job.sheet!;
  const L = LAYOUTS[spec.layout];
  job.log.push(`Job: /sheet edit → ${job.folder} · model ${task.model} · effort ${task.effort}`);
  try {
    // Files, not the prompt, carry the reader's words: the prompt must be one
    // line with quotes stripped (oneLine), and a request should arrive intact.
    const current = path.join(task.dir, "current-sheet.html");
    const req = path.join(task.dir, "request.txt");
    const conv = path.join(task.dir, "conversation.txt");
    writeFileSync(current, task.html.replace(/(<(?:h2|h3|p|li|tr|table|ul|ol|pre|svg|div)[\s>])/g, "\n$1"));
    await writeFile(req, request);
    await writeFile(
      conv,
      history.slice(-12).map((m) => `${m.role === "user" ? "Reader" : "You"}: ${m.text}`).join("\n\n") || "(none)"
    );
    const chapterFiles = task.chapters.map((c) => oneLine(c.path)).join(", ");
    const prompt =
      `/sheet Edit mode. Do not create, write or edit any file; you only have read access. ` +
      `The current cheatsheet for chapters ${spec.from} to ${spec.to} is at ${oneLine(current)}. ` +
      `The reader's request is in ${oneLine(req)}, and the conversation so far is in ${oneLine(conv)}. ` +
      `Chapter files, in order: ${chapterFiles}. ` +
      sourcesLine(task) +
      paperLine(spec, spec.pages ? L.budget * spec.pages : undefined) +
      `Change what the request asks and keep everything else; every rule of the cheatsheet guidelines still applies, and nothing may come from outside the source files. ` +
      `If the request asks for something the sources do not support, leave that part alone and say so. ` +
      `Reply with one line starting "NOTE:" that tells the reader in plain words what you changed, then the complete fragment, starting at the first <h2>.`;
    const result = await writeChecked(job, task, repoRoot, prompt, (html) => sheetChecks(spec, task, html));
    if (!result) {
      if (job.status === "running") job.status = "error";
      return;
    }
    const before = task.html;
    const html = result.html;
    const changed = changedSections(before, html);
    const at = new Date().toISOString();
    await awaitSave(job, task, {
      html,
      last: true,
      done: `Saved the change (${changed.length ? `chapter(s) ${changed.join(", ")}` : "no section changed"}).`,
      update: (m) => {
        const review = reviewOf(m);
        const extra = [...(m.spec.extra ?? [])];
        for (const r of addRefs) if (!extra.some((e) => e.kind === r.kind && e.id === r.id)) extra.push(r);
        return {
          ...m,
          spec: { ...m.spec, extra },
          checks: result.open,
          // A changed chapter needs reviewing again; the rest keep theirs.
          review: {
            reviewed: review.reviewed.filter((n) => !changed.includes(n)),
            issues: Object.fromEntries(Object.entries(review.issues).filter(([k]) => !changed.includes(Number(k)))),
          },
          messages: [
            ...m.messages,
            { role: "user", text: request, at: new Date(job.startedAt).toISOString() },
            { role: "assistant", text: result.note || "Done.", at },
          ],
        };
      },
    });
  } finally {
    cleanup(job, task);
  }
}

// --- review: one chapter per run ------------------------------------------------------

async function reviewLoop(job: Job, task: Task, order: number[], repoRoot: string): Promise<void> {
  const spec = job.sheet!;
  const sections = sectionsOf(task.html);
  let total = 0;
  job.log.push(`Job: /sheet review → ${job.folder} · ${order.length} chapter(s) · model ${task.model} · effort ${task.effort}`);
  try {
    for (let i = 0; i < order.length; i++) {
      const seq = order[i];
      if (job.status !== "running") return;
      const ch = task.chapters.find((c) => c.seq === seq);
      const section = sections.get(seq);
      let issues: string[] | null;
      if (!ch) issues = [`missing: chapter ${seq}'s lesson is no longer in the folder, so it can't be checked`];
      else if (!section) issues = [`missing: the sheet has no section for chapter ${seq}`];
      else {
        job.log.push(`Reviewing chapter ${seq} (${i + 1} of ${order.length}).`);
        issues = await reviewSection(job, task, repoRoot, seq, section, ch.path);
      }
      if (issues === null) {
        if (job.status === "running") {
          job.status = "error";
          job.log.push(
            `The review stopped at chapter ${seq}.${i > 0 ? " The chapters before it are saved — run the review again to continue." : ""}`
          );
        }
        return;
      }
      total += issues.length;
      job.log.push(`Chapter ${seq}: ${issues.length ? `${issues.length} finding(s): ${issues.join("; ")}` : "nothing to fix"}.`);
      const last = i === order.length - 1;
      const found = issues;
      const ok = await awaitSave(job, task, {
        html: null,
        last,
        done: `Saved the review of chapter ${seq}.`,
        update: (m) => {
          const review = reviewOf(m);
          return {
            ...m,
            review: {
              reviewed: [...new Set([...review.reviewed, seq])].sort((a, b) => a - b),
              issues: { ...review.issues, [seq]: found },
            },
            messages: last
              ? [
                  ...m.messages,
                  {
                    role: "assistant",
                    text: total
                      ? `Reviewed ${order.length} chapter(s) against the sources: ${total} finding(s), listed with the checks.`
                      : `Reviewed ${order.length} chapter(s) against the sources: nothing to fix.`,
                    at: new Date().toISOString(),
                  },
                ]
              : m.messages,
          };
        },
      });
      if (!ok) return;
    }
  } finally {
    cleanup(job, task);
  }
}

/** A fresh session (never the writer's) checks one section; null on failure. */
async function reviewSection(
  job: Job,
  task: Task,
  repoRoot: string,
  seq: number,
  section: string,
  chapterPath: string
): Promise<string[] | null> {
  const file = path.join(task.dir, `review-ch${seq}.html`);
  await writeFile(file, section.replace(/(<(?:h2|h3|p|li|tr|table|ul|ol|pre|svg|div)[\s>])/g, "\n$1"));
  const unverified = sourceIssues(
    section,
    [],
    true,
    [readFileSync(chapterPath, "utf8"), ...task.docs.map((d) => d.text)].map(plainText)
  ).unverified;
  const prompt =
    `/sheet Review mode. Do not create, write or edit any file. ` +
    `Review the section for chapter ${seq} at ${oneLine(file)}. Its sources are the chapter file ${oneLine(chapterPath)}` +
    (task.docs.length ? ` and ${task.docs.map((d) => oneLine(d.path)).join(", ")} (use only what belongs to chapter ${seq})` : "") +
    `. ` +
    (unverified.length ? `These numbers in the section are not in the sources; check each: ${unverified.slice(0, 30).join(", ")}. ` : "") +
    `Follow the review section of the /sheet command. Reply with only a JSON object and nothing else, of the form {"issues":[{"kind":"wrong|unsupported|missing|unclear","where":"a short exact quote from the section","fix":"what the sources say"}]}. An empty list means the section is correct and complete.`;
  const run = await runSheet(job, task, repoRoot, prompt);
  if (!run.ok) {
    explainFailure(job);
    return null;
  }
  const a = run.reply.indexOf("{");
  const b = run.reply.lastIndexOf("}");
  if (a === -1 || b <= a) {
    job.log.push("The review answered in a shape that can't be read.");
    return null;
  }
  try {
    const parsed = JSON.parse(run.reply.slice(a, b + 1));
    if (!Array.isArray(parsed?.issues)) return null;
    return parsed.issues
      .filter((i: any) => i && typeof i === "object")
      .map((i: any) => `${String(i.kind ?? "issue")}: "${String(i.where ?? "").slice(0, 160)}" → ${String(i.fix ?? "").slice(0, 300)}`);
  } catch {
    job.log.push("The review answered in a shape that can't be read.");
    return null;
  }
}
