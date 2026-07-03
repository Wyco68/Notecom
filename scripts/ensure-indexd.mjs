// Makes sure indexd (the search/RAG service) is up — same job as
// ensure-vaultd.mjs, same reasons: it's a separate process, it doesn't
// restart on its own, and without it /api/search 502s silently. Search is
// optional infrastructure (the reader works without it), so callers may
// treat a failure here as a warning rather than fatal.

import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";

const INDEXD_URL = process.env.INDEXD_URL || "http://127.0.0.1:4322";
const INDEXD_DIR = path.join(process.cwd(), "tools", "indexd");
const BIN_NAME = process.platform === "win32" ? "indexd.exe" : "indexd";
const BIN_PATH = path.join(INDEXD_DIR, BIN_NAME);

async function isUp() {
  try {
    const res = await fetch(`${INDEXD_URL}/status`, { signal: AbortSignal.timeout(1500) });
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

export async function ensureIndexd() {
  if (await isUp()) {
    console.log(`indexd already running at ${INDEXD_URL}`);
    return;
  }

  if (!existsSync(BIN_PATH)) {
    console.log("indexd binary missing, building it...");
    await run("go", ["build", "-o", BIN_NAME, "."], { cwd: INDEXD_DIR, stdio: "inherit" });
  }

  console.log("starting indexd...");
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
  if (!up) {
    const detail = output.trim();
    const hint = /address already in use|bind:/i.test(detail)
      ? ` Another process is already using ${INDEXD_URL} — stop it (check \`netstat -ano | findstr 4322\`) and try again.`
      : "";
    throw new Error(
      `indexd did not come up at ${INDEXD_URL} within 5s.${hint}${detail ? ` indexd output: ${detail}` : ""}`
    );
  }
  console.log(`indexd up at ${INDEXD_URL}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureIndexd().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
