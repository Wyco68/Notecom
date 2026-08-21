// Headless Claude Code job runner for in-app lesson/quiz generation.
//
// The app never generates content itself — it delegates to the local
// Claude Code CLI (the same `/lect` / `/quiz` commands used in a terminal),
// which runs on the user's existing Claude subscription. No API key, no
// separate billing. Desktop/local only by design.
//
// CLAUDE_BIN overrides the binary — used by tests to substitute a stub so
// verification never burns tokens or writes a real lesson.

import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import path from "path";

export interface Job {
  id: string;
  status: "running" | "done" | "error" | "aborted";
  folder: string;
  kind: "lect" | "quiz";
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
}

// globalThis survives Next.js dev hot-reload; a plain module Map doesn't.
const jobs: Map<string, Job> =
  (globalThis as any).__generateJobs ?? ((globalThis as any).__generateJobs = new Map());

// One chain per folder: /lect and /quiz both compute "next seq = max
// existing + 1" by reading the folder's index.json themselves, so two runs
// racing on the *same* folder can read the same max and step on each
// other's write, or simply finish in a different order than the user
// started them in. Chaining a same-folder run behind the previous one (each
// link resolves once its run's process actually exits) is what keeps
// 1, 2, 3 landing as 1, 2, 3 — a different folder's runs are a different
// chain and still run fully in parallel, up to MAX_CONCURRENT_JOBS on the
// client.
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
 * the log or the child handle — enough for a reloaded client to spot a run
 * still in flight and re-attach to its stream. The log itself comes from the
 * tail, which replays from the beginning anyway.
 */
export function listJobs(userId: string): Array<Omit<Job, "log" | "child">> {
  return [...jobs.values()]
    .filter((j) => j.startedBy === userId)
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(({ log: _log, child: _child, ...rest }) => rest);
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
  // Without the command file, claude "succeeds" with a confused one-turn
  // reply and no generated file — fail fast and say why.
  const repoRoot = process.env.REPO_ROOT || process.cwd();
  const commandFile = path.join(repoRoot, ".claude", "commands", `${kind}.md`);
  if (!existsSync(commandFile)) {
    job.log.push(
      `Generate needs the project checkout: /${kind} is defined by .claude/commands/${kind}.md, ` +
        `which doesn't exist at ${repoRoot}.`,
      "Check the app was set up per docs/GETTING_STARTED.md (clone + npm run setup), or use /lect directly in Claude Code."
    );
    job.status = "error";
    return job;
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
  // The Generate dialog only offers folders that already exist (its
  // dropdown is the sidebar tree), so `folder` is always a real vault
  // directory name. State that explicitly: vault/ is gitignored, and Claude
  // Code's Glob/search tools skip gitignored paths, so /lect's "list
  // existing folders" step finds nothing and would create a lowercase
  // duplicate (e.g. wireless-network beside Wireless-Network). Pinning the
  // exact existing folder + its absolute path sidesteps that discovery.
  const safeOriginal = originalName.replace(/["%\r\n]/g, "");
  const noun = kind === "quiz" ? "quiz" : "lesson";
  const vaultPath = path.join(repoRoot, "vault", folder);
  const prompt =
    `/${kind} ${folder}. ` +
    `The destination folder already exists at ${vaultPath} — save the ${noun} into that exact existing folder. ` +
    `Do not list vault folders, do not create a new folder, and do not lowercase or re-slugify the name; use "${folder}" verbatim as the folder. ` +
    `The uploaded lecture file is saved at ${filePath} (original name: ${safeOriginal}); ` +
    `read it from that path and convert it with the markitdown tool, then continue the command workflow. ` +
    // The /${kind} docs are the single source of truth for structure and
    // style — reading other lessons' HTML to imitate them wastes tokens and
    // drifts from the template. (Reading the folder's index.json for the
    // next seq number is still fine — that's not lesson content.)
    `Follow the /${kind} command's own template and output contract exactly for structure and style; do not open other existing ${noun} HTML files to copy their style. ` +
    // Strict generation: the ${noun}'s content is the uploaded file, not the
    // model's prior knowledge. Grounding it in the source (and failing rather
    // than fabricating) is what keeps the saved file — which stored persists
    // to SQLite and syncs to Supabase — faithful to the actual lecture.
    `Ground every claim strictly in that uploaded source; do not invent, pad, or generalize beyond what it contains. If the file cannot be read or converted, stop and report that instead of fabricating a ${noun}. ` +
    // Keep the job log tidy: the closing summary the model would otherwise
    // write is the "long output after work is done" the user doesn't want.
    `When the ${noun} is saved, reply with only a single short confirmation line — do not summarize the ${noun} or recap the steps you took.`;

  // Queue behind whatever is already running in this same folder — see
  // folderChains above. `.catch()` on the stored link (not the returned
  // promise) so one run's rejection can never wedge the folder's queue for
  // whatever comes after it.
  const alreadyQueued = folderChains.has(folder);
  if (alreadyQueued) {
    job.log.push(`Queued — waiting for another generation in "${folder}" to finish first.`);
  }
  const priorInFolder = folderChains.get(folder) ?? Promise.resolve();
  const thisRun = priorInFolder.then(() =>
    beginRun(job, repoRoot, folder, kind, filePath, prompt, safeOriginal)
  );
  folderChains.set(folder, thisRun.catch(() => {}));

  return job;
}

function beginRun(
  job: Job,
  repoRoot: string,
  folder: string,
  kind: "lect" | "quiz",
  filePath: string,
  prompt: string,
  safeOriginal: string
): Promise<void> {
  return new Promise((resolveRun) => {
    // Aborted (or otherwise no longer running) while it sat queued behind an
    // earlier same-folder job — never spawn it, and let the chain move on.
    if (job.status !== "running") {
      resolveRun();
      return;
    }

    const bin = process.env.CLAUDE_BIN || "claude";
    const model = process.env.GENERATE_MODEL || "sonnet";
    const useShell = process.platform === "win32"; // the CLI is a .cmd shim on Windows
    const promptArg = useShell ? `"${prompt}"` : prompt;
    // --dangerously-skip-permissions: the prompt is a fixed template built
    // from an allowlisted kind + an existing folder name, running on the
    // user's own machine against their own vault — interactive permission
    // prompts would just hang the headless run.
    const child = spawn(
      bin,
      ["-p", promptArg, "--model", model, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"],
      { cwd: repoRoot, shell: useShell, stdio: ["ignore", "pipe", "pipe"] }
    );
    job.log.push(`Job: /${kind} → ${folder} (${safeOriginal}) · model ${model}`);

    let buf = "";
    // Success requires claude's own final `result` event, not just exit code
    // 0 — a run that never engaged (bad prompt expansion, wrong cwd, CLI
    // printing plain text instead of stream-json) exits 0 without one, and
    // that must surface as a failure, not a false "finished".
    let sawResult = false;
    let resultFailed = false;
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
              job.log.push(block.text.trim());
            } else if (block.type === "tool_use") {
              job.log.push(`→ ${block.name}`);
            }
          }
        } else if (ev.type === "result") {
          sawResult = true;
          resultFailed = !!ev.is_error;
          // the result event carries authoritative totals — overwrite
          if (ev.usage) {
            job.tokens.input = ev.usage.input_tokens ?? job.tokens.input;
            job.tokens.output = ev.usage.output_tokens ?? job.tokens.output;
          }
          job.log.push(ev.is_error ? `Failed: ${ev.result ?? "unknown error"}` : "Finished.");
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
            "generate from the desktop app (or your own checkout) instead."
          : "Generation failed to start — check the server logs."
      );
      job.status = "error";
      job.child = undefined;
      resolveRun();
    });
    child.on("close", (code) => {
      if (job.status === "running") {
        if (code === 0 && sawResult && !resultFailed) {
          // Lesson saved to vault/. The client's sync() call (fired on
          // completedTick, see GenerateJobsProvider.tsx) POSTs /api/tree, which
          // ingests it straight into Supabase — nothing to do here.
          job.status = "done";
        } else {
          job.status = "error";
          if (code !== 0) {
            job.log.push(`claude exited with code ${code}`);
          } else if (!sawResult) {
            job.log.push(
              "claude exited without completing the command — no result was produced, so nothing was generated. " +
                "The output above shows what it did instead."
            );
          }
          // Classify the failure so the user knows whether to just retry.
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
      }
      job.child = undefined;
      resolveRun();
    });

    job.child = child;
  });
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
  // Else: still queued behind another run in the same folder — beginRun's
  // own status check skips spawning it once its turn comes, so there is no
  // process to kill yet, just the queue slot to give up.
  return true;
}
