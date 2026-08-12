// Claude Code CLI sign-in, driven from the app.
//
// The app delegates generation to the local `claude` CLI, so it depends on
// that CLI's own session. When the session expires the only fix used to be
// "go run `claude auth login` in a terminal", which is a dead end inside the
// packaged desktop app where there is no terminal.
//
// This runs the CLI's real login flow as a child process and relays it to the
// UI. The hard rule: the app never becomes a credential holder. It does not
// read, store, or transmit the token — `claude` writes it to its own
// credential store exactly as it does from a terminal, and the app only ever
// sees the CLI's stdout and the boolean from `claude auth status`. There is
// deliberately no API-key field anywhere: an app that stores a key would be a
// second place for it to leak from, and would break the "no API key, runs on
// the user's subscription" property the whole design rests on.

import { spawn, spawnSync, type ChildProcess } from "child_process";

export interface AuthStatus {
  loggedIn: boolean;
  /** "claudeai" | "console" | "none" — as reported by the CLI */
  authMethod: string;
  /** false when `claude` isn't on PATH at all — this machine cannot generate
   *  no matter who signs in. True even when installed but logged out. */
  installed: boolean;
}

export interface LoginSession {
  status: "running" | "done" | "error" | "aborted";
  log: string[];
  /** OAuth URL scraped from the CLI's output, for the UI to link/open */
  url?: string;
  /** true once the CLI appears to be waiting for a pasted auth code */
  awaitingCode: boolean;
  startedAt: number;
  child?: ChildProcess;
}

// Only one login can be in flight — a second concurrent flow would race for
// the same credential file. globalThis survives Next.js dev hot-reload.
const g = globalThis as any;
let session: LoginSession | undefined = g.__authLogin;
const setSession = (s: LoginSession | undefined) => {
  session = s;
  g.__authLogin = s;
};

export function getLoginSession(): LoginSession | undefined {
  return session;
}

const bin = () => process.env.CLAUDE_BIN || "claude";
// The CLI is a .cmd shim on Windows, which only resolves through a shell.
const useShell = () => process.platform === "win32";

// Cached: PATH doesn't change mid-process, and this runs on every /api/auth
// poll otherwise. A hosted instance has no `claude` on PATH by design (see
// docs/architecture.md) — this is the signal the UI uses to say so instead of
// dead-ending on a failed sign-in attempt.
let cachedInstalled: boolean | null = null;
export function cliInstalled(): boolean {
  if (cachedInstalled !== null) return cachedInstalled;
  const result = spawnSync(bin(), ["--version"], { shell: useShell(), stdio: "ignore" });
  // Under shell:true (Windows), a missing binary doesn't set `.error` — the
  // shim (cmd.exe) itself spawns fine and just exits non-zero ("not
  // recognized"). `.error` alone only catches the non-shell (POSIX) ENOENT
  // case, so both must hold.
  cachedInstalled = !result.error && result.status === 0;
  return cachedInstalled;
}

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// Belt and braces: the login flow is not supposed to print a long-lived
// secret, but if a future CLI version ever echoes one, it must not land in a
// log buffer the UI renders and keeps. URLs are left intact — the OAuth URL
// is the one long string the user actually needs.
function redactSecrets(line: string): string {
  return line.replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-[redacted]");
}

/** Current CLI auth state. Read-only — never starts a flow. */
export async function readStatus(): Promise<AuthStatus> {
  return new Promise((resolve) => {
    const child = spawn(bin(), ["auth", "status", "--json"], {
      shell: useShell(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    // A missing CLI is not an error state to shout about — it just means not
    // signed in, and the UI says how to install it.
    child.on("error", () => resolve({ loggedIn: false, authMethod: "none", installed: false }));
    child.on("close", () => {
      try {
        const j = JSON.parse(stripAnsi(out));
        resolve({
          loggedIn: !!j.loggedIn,
          authMethod: String(j.authMethod ?? "none"),
          installed: cliInstalled(),
        });
      } catch {
        resolve({ loggedIn: false, authMethod: "none", installed: cliInstalled() });
      }
    });
  });
}

const URL_RE = /(https?:\/\/[^\s"'<>]+)/;
// The CLI asks for a pasted code only when it cannot complete the browser
// callback itself; the UI reveals its code box on this signal alone.
const CODE_PROMPT_RE = /paste|enter the code|authorization code|verification code/i;

/**
 * Start `claude auth login`. Returns the live session; the caller streams
 * `log`/`url` to the UI. Completion is confirmed by re-reading auth status,
 * not by trusting the exit code.
 */
export function startLogin(mode: "claudeai" | "console" = "claudeai"): LoginSession {
  const existing = session;
  if (existing?.status === "running") return existing;

  const s: LoginSession = {
    status: "running",
    log: [],
    awaitingCode: false,
    startedAt: Date.now(),
  };
  setSession(s);

  // stdin stays open: if the flow falls back to a pasted code, the UI sends
  // it through submitCode() below.
  const child = spawn(bin(), ["auth", "login", `--${mode}`], {
    shell: useShell(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  const onText = (raw: string) => {
    for (const part of stripAnsi(raw).split("\n")) {
      const line = redactSecrets(part.trim());
      if (!line) continue;
      s.log.push(line);
      if (!s.url) {
        const m = URL_RE.exec(line);
        // Only the provider's own sign-in URL is worth surfacing.
        if (m && /anthropic\.com|claude\.ai/.test(m[1])) s.url = m[1];
      }
      if (CODE_PROMPT_RE.test(line)) s.awaitingCode = true;
    }
  };

  child.stdout.on("data", (d: Buffer) => onText(d.toString()));
  child.stderr.on("data", (d: Buffer) => onText(d.toString()));

  child.on("error", (err) => {
    s.log.push(
      err.message.includes("ENOENT")
        ? "Claude Code CLI not found — install it and make sure `claude` is on PATH."
        : `Error: ${err.message}`
    );
    s.status = "error";
    s.child = undefined;
  });

  child.on("close", async () => {
    s.child = undefined;
    if (s.status !== "running") return;
    // The CLI is the authority on whether the session took, so ask it rather
    // than inferring success from an exit code.
    const st = await readStatus();
    s.status = st.loggedIn ? "done" : "error";
    s.awaitingCode = false;
    s.log.push(st.loggedIn ? "Signed in." : "Sign-in did not complete.");
  });

  s.child = child;
  return s;
}

/**
 * Forward a pasted authorization code to the waiting CLI. The code is written
 * straight to the child's stdin and never stored or logged — it is a
 * single-use value that belongs to the CLI's flow, not to this app.
 */
export function submitCode(code: string): boolean {
  const s = session;
  if (!s || s.status !== "running" || !s.child?.stdin) return false;
  s.child.stdin.write(code.trim() + "\n");
  s.awaitingCode = false;
  s.log.push("Code submitted.");
  return true;
}

/** Cancel an in-flight login (the UI's Cancel button). */
export function cancelLogin(): boolean {
  const s = session;
  if (!s || s.status !== "running" || !s.child?.pid) return false;
  s.status = "aborted";
  s.log.push("Cancelled.");
  // shell:true means the direct child is a cmd.exe shim on Windows, so the
  // whole tree has to go — same reasoning as the generate runner's stopJob.
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(s.child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    s.child.kill("SIGTERM");
  }
  s.child = undefined;
  return true;
}

/** Sign out — clears the CLI's stored credential, not anything of ours. */
export async function logout(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin(), ["auth", "logout"], {
      shell: useShell(),
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
