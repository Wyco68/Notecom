// Makes sure vaultd is up. vaultd is a separate process from Next.js (see
// docs/architecture.md) and doesn't restart on its own — without this,
// every API route silently 502s until someone notices and starts it by
// hand. Exported so other scripts (open-app.mjs) can reuse the same check
// instead of duplicating it.

import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";

const VAULTD_URL = process.env.VAULTD_URL || "http://127.0.0.1:4321";
const VAULTD_DIR = path.join(process.cwd(), "tools", "vaultd");
const BIN_NAME = process.platform === "win32" ? "vaultd.exe" : "vaultd";
const BIN_PATH = path.join(VAULTD_DIR, BIN_NAME);

async function isUp() {
  try {
    const res = await fetch(`${VAULTD_URL}/tree`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: process.platform === "win32", ...opts });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function waitUntilUp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isUp()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

export async function ensureVaultd() {
  if (await isUp()) {
    console.log(`vaultd already running at ${VAULTD_URL}`);
    return;
  }

  if (!existsSync(BIN_PATH)) {
    console.log("vaultd binary missing, building it...");
    await run("go", ["build", "-o", BIN_NAME, "."], { cwd: VAULTD_DIR, stdio: "inherit" });
  }

  console.log("starting vaultd...");
  // stdio is piped (not "ignore") so a bind failure — e.g. another process
  // already holding the port — has its message captured instead of
  // silently discarded, which used to surface as an opaque "did not come
  // up within 5s" with no way to tell a port conflict from a slow start.
  let output = "";
  const child = spawn(BIN_PATH, [], {
    cwd: process.cwd(),
    detached: true,
    // windowsHide stops a console window from flashing up when this is
    // launched from a GUI context (e.g. /quiz -> open-app.mjs).
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  child.unref();

  const up = await waitUntilUp(5000);
  if (!up) {
    const detail = output.trim();
    const hint = /address already in use|bind:/i.test(detail)
      ? ` Another process is already using ${VAULTD_URL} — stop it (check \`netstat -ano | findstr 4321\`) and try again.`
      : "";
    throw new Error(
      `vaultd did not come up at ${VAULTD_URL} within 5s.${hint}${detail ? ` vaultd output: ${detail}` : ""}`
    );
  }
  console.log(`vaultd up at ${VAULTD_URL}`);
}

// pathToFileURL handles Windows drive letters/backslashes correctly — a
// plain `file://${process.argv[1]}` never matched import.meta.url on
// Windows, so running this file directly silently no-op'd.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureVaultd().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
