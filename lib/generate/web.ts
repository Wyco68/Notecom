// A lesson or quiz written by a web service the reader picked, with their own
// API key. It joins the same job list as a Claude Code run, so the dialog, the
// sidebar row, the log stream and the save (POST /api/generate/[id]) treat
// both alike; only who writes the document differs.
//
// The key lives in this closure for the length of the run and nowhere else:
// it is not on the job, not in the log, and not written anywhere.

import { randomUUID } from "crypto";
import { chat, AiError, type Part, type Turn } from "../ai/chat";
import { WEB_SERVICES, type WebService } from "../ai/services";
import { checkLesson, checkQuiz, extractHtml } from "./validate";
import { queueInFolder, registerJob, type Job } from "./runner";
import { systemPrompt } from "./template";

const MAX_FIXES = 2;
// A whole run, fix rounds included. A slow service must not hold the
// folder's queue, or the reader's slot, indefinitely.
const MAX_RUN_MS = 15 * 60_000;

export interface WebRun {
  service: WebService;
  key: string;
  model: string;
}

export function startWebJob(
  folder: string,
  folderId: string,
  kind: "lect" | "quiz",
  source: { parts: Part[]; summary: string },
  originalName: string,
  startedBy: string,
  run: WebRun
): Job {
  const label = WEB_SERVICES[run.service].label;
  const job: Job = {
    id: randomUUID(),
    status: "running",
    folder,
    kind,
    log: [`${label} · ${run.model}`, `Read ${originalName} (${source.summary}).`],
    startedAt: Date.now(),
    tokens: { input: 0, output: 0 },
    startedBy,
    service: label,
    folderId,
    abort: new AbortController(),
  };
  registerJob(job);
  queueInFolder(job, async () => {
    try {
      await write(job, source.parts, run, label);
    } finally {
      // The run is over either way: nothing left to cancel.
      job.abort = undefined;
    }
  });
  return job;
}

async function write(job: Job, source: Part[], run: WebRun, label: string): Promise<void> {
  const kind = job.kind === "quiz" ? "quiz" : "lect";
  const noun = kind === "quiz" ? "quiz" : "lesson";
  const timeout = AbortSignal.timeout(MAX_RUN_MS);
  const signal = AbortSignal.any([job.abort!.signal, timeout]);
  const turns: Turn[] = [
    {
      role: "user",
      parts: [
        ...source,
        { kind: "text", text: `Write the ${noun} from this source. Reply with only its complete HTML, starting at the <h1>.` },
      ],
    },
  ];

  let system: string;
  try {
    system = systemPrompt(kind);
  } catch {
    fail(job, "The lesson template couldn't be read on this server. Nothing was sent.");
    return;
  }

  for (let fixes = 0; ; fixes++) {
    if (job.status !== "running") return;
    job.log.push(fixes ? `Asking ${label} to fix it (${fixes} of ${MAX_FIXES}).` : `Writing the ${noun}…`);

    // The live counter shows the reply growing; the exact count replaces it
    // when the reply is done.
    const before = { ...job.tokens };
    let result;
    try {
      result = await chat({
        ...run,
        system,
        turns,
        signal,
        onProgress: (chars) => {
          job.tokens = { input: before.input, output: before.output + Math.round(chars / 4) };
        },
      });
    } catch (err) {
      if (job.status !== "running") return;
      fail(job, timeout.aborted ? `${label} took longer than 15 minutes — stopped. Nothing was saved.` : explain(err, label));
      return;
    }
    if (job.status !== "running") return;
    job.tokens = { input: before.input + result.usage.input, output: before.output + result.usage.output };

    if (result.truncated) {
      fail(job, `The reply hit the model's output limit and was cut off. Nothing was saved. Try a model with a larger output limit.`);
      return;
    }
    const html = extractHtml(result.text);
    if (!html) {
      const said = result.text.trim().replace(/\s+/g, " ").slice(0, 300);
      fail(job, `No ${noun} came back${said ? `. The model said: ${said}` : "."} Nothing was saved.`);
      return;
    }
    const violations = kind === "quiz" ? checkQuiz(html) : checkLesson(html);
    if (!violations.length) {
      job.log.push("Received the generated HTML.", `The ${noun} passed the contract check — saving it.`);
      job.html = html;
      job.pictures = new Map();
      job.status = "ready";
      return;
    }

    job.log.push(`Contract check failed: ${violations.join("; ")}`);
    if (fixes >= MAX_FIXES) {
      fail(job, `Still failing after ${fixes} fix attempt(s) — nothing was saved.`);
      return;
    }
    turns.push(
      { role: "assistant", parts: [{ kind: "text", text: result.text }] },
      {
        role: "user",
        parts: [
          {
            kind: "text",
            text:
              `The app rejected that ${noun} against its output contract: ` +
              violations.slice(0, 10).map((v) => v.slice(0, 200)).join("; ") +
              `. Fix exactly these problems without changing anything else, and reply with only the complete corrected HTML, starting at the <h1>.`,
          },
        ],
      }
    );
  }
}

function fail(job: Job, line: string) {
  job.log.push(line);
  job.status = "error";
}

function explain(err: unknown, label: string): string {
  if (!(err instanceof AiError)) return `${label} failed. Nothing was saved.`;
  const detail = err.message ? ` (${err.message})` : "";
  switch (err.kind) {
    case "auth":
      return `${label} didn't accept the API key. Check it in the Generate dialog. Nothing was saved.`;
    case "rate":
      return `${label} says the rate limit or quota is used up. Wait a bit, then generate again.${detail}`;
    case "bad-request":
      return `${label} refused the request${detail}. Nothing was saved.`;
    case "refused":
      return `The model declined to write this one. Nothing was saved.`;
    case "network":
      return `Couldn't reach ${label}. Nothing was saved — generate again.`;
    case "aborted":
      return "Stopped.";
    default:
      return `${label} failed${detail}. Nothing was saved.`;
  }
}
