// Makes sure stored (the SQLite primary-datastore service) is up — same job
// and same pattern as ensure-vaultd.mjs / ensure-indexd.mjs. Unlike indexd,
// stored is NOT optional: every read and write in the app goes through it,
// so a failure here is fatal to the dev/start flow.

import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";

const STORED_URL = process.env.STORED_URL || "http://127.0.0.1:4323";
const STORED_DIR = path.join(process.cwd(), "tools", "stored");
const BIN_NAME = process.platform === "win32" ? "stored.exe" : "stored";
const BIN_PATH = path.join(STORED_DIR, BIN_NAME);

async function isUp() {
  try {
    const res = await fetch(`${STORED_URL}/status`, { signal: AbortSignal.timeout(1500) });
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

export async function ensureStored() {
  if (await isUp()) {
    console.log(`stored already running at ${STORED_URL}`);
    return;
  }

  if (!existsSync(BIN_PATH)) {
    console.log("stored binary missing, building it...");
    await run("go", ["build", "-o", BIN_NAME, "."], { cwd: STORED_DIR, stdio: "inherit" });
  }

  console.log("starting stored...");
  let output = "";
  const child = spawn(BIN_PATH, [], {
    cwd: process.cwd(),
    detached: true,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  child.unref();

  const up = await waitUntilUp(5000);
  // Destroy the pipes or this script never exits (they hold the event
  // loop open even after unref) — same fix as ensure-vaultd.mjs.
  child.stdout.destroy();
  child.stderr.destroy();
  if (!up) {
    const detail = output.trim();
    const hint = /address already in use|bind:/i.test(detail)
      ? ` Another process is already using ${STORED_URL} — stop it (check \`netstat -ano | findstr 4323\`) and try again.`
      : "";
    throw new Error(
      `stored did not come up at ${STORED_URL} within 5s.${hint}${detail ? ` stored output: ${detail}` : ""}`
    );
  }
  console.log(`stored up at ${STORED_URL}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureStored().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
