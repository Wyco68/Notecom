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

export interface Job {
  id: string;
  status: "running" | "done" | "error" | "aborted";
  folder: string;
  kind: "lect" | "quiz";
  log: string[];
  startedAt: number;
  tokens: { input: number; output: number };
  /** live process handle — undefined once the job has finished */
  child?: ChildProcess;
}

// globalThis survives Next.js dev hot-reload; a plain module Map doesn't.
const jobs: Map<string, Job> =
  (globalThis as any).__generateJobs ?? ((globalThis as any).__generateJobs = new Map());

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function startJob(
  folder: string,
  kind: "lect" | "quiz",
  filePath: string,
  originalName: string
): Job {
  const job: Job = {
    id: randomUUID(),
    status: "running",
    folder,
    kind,
    log: [],
    startedAt: Date.now(),
    tokens: { input: 0, output: 0 },
  };
  jobs.set(job.id, job);

  // The prompt must satisfy three hard constraints at once:
  // 1. It must be the -p ARGUMENT, not stdin — the CLI only expands custom
  //    slash commands "in the prompt string"; a piped prompt left /lect
  //    unexpanded and Claude exited without generating anything.
  // 2. It must be a SINGLE LINE — cmd.exe truncates arguments at newlines.
  // 3. It must be QUOTED BY US — spawn with shell:true performs no
  //    escaping, so an unquoted multi-word prompt splits into separate
  //    argv words. `%` and `"` are stripped because cmd.exe expands/breaks
  //    them even inside quotes.
  const safeOriginal = originalName.replace(/["%\r\n]/g, "");
  const prompt =
    `/${kind} ${folder}. ` +
    `The uploaded lecture file is saved at ${filePath} (original name: ${safeOriginal}); ` +
    `read it from that path and convert it with the markitdown tool, then continue the command workflow normally.`;

  const bin = process.env.CLAUDE_BIN || "claude";
  const useShell = process.platform === "win32"; // the CLI is a .cmd shim on Windows
  const promptArg = useShell ? `"${prompt}"` : prompt;
  // --dangerously-skip-permissions: the prompt is a fixed template built
  // from an allowlisted kind + an existing folder name, running on the
  // user's own machine against their own vault — interactive permission
  // prompts would just hang the headless run.
  const child = spawn(
    bin,
    ["-p", promptArg, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"],
    { cwd: process.cwd(), shell: useShell, stdio: ["ignore", "pipe", "pipe"] }
  );
  job.log.push(`Job: /${kind} → ${folder} (${safeOriginal})`);

  let buf = "";
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
    job.log.push(
      err.message.includes("ENOENT")
        ? "Claude Code CLI not found — install it and make sure `claude` is on PATH."
        : `Error: ${err.message}`
    );
    job.status = "error";
    job.child = undefined;
  });
  child.on("close", (code) => {
    if (job.status === "running") {
      job.status = code === 0 ? "done" : "error";
      if (code !== 0) job.log.push(`claude exited with code ${code}`);
    }
    job.child = undefined;
  });

  job.child = child;
  return job;
}

// stopJob force-kills a running job (the UI's Ctrl+C). shell:true means
// the direct child is a cmd.exe shim, so the whole tree must go —
// taskkill /T on Windows, plain kill elsewhere.
export function stopJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.status !== "running" || !job.child?.pid) return false;
  job.status = "aborted";
  job.log.push("^C — aborted by user.");
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(job.child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    job.child.kill("SIGTERM");
  }
  job.child = undefined;
  return true;
}
