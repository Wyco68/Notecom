// Tauri's `beforeBuildCommand` for `desktop/`. Assembles everything the
// packaged app needs that isn't Rust source: a Node runtime as an externalBin
// sidecar (Tauri's naming convention requires a `<name>-<target-triple>`
// suffix), plus the Next.js standalone server as a bundled resource. See
// docs/desktop.md.
//
// The three Go sidecars this used to cross-build (vaultd, indexd, stored) are
// gone: the app reads and writes Supabase directly, so nothing local is served.

import { spawnSync } from "child_process";
import { existsSync, mkdirSync, rmSync, cpSync, copyFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { targetTriple } from "./desktop-target-triple.mjs";

// Resolved from this file's location, not process.cwd() — Tauri's
// beforeBuildCommand cwd varies by how `tauri build` was invoked.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP_DIR = path.join(ROOT, "desktop");
const BIN_DIR = path.join(DESKTOP_DIR, "bin");
const RESOURCES_DIR = path.join(DESKTOP_DIR, "resources", "frontend");

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${result.status}`);
  }
}

function buildNextStandalone() {
  // Wipe .next first. `next dev --turbopack` (our dev script) leaves
  // turbopack chunks in .next; a following production `next build` uses
  // webpack and chokes on them ("Cannot find module .../[turbopack]_runtime.js").
  // A clean tree makes the build deterministic no matter what ran before.
  rmSync(path.join(ROOT, ".next"), { recursive: true, force: true });
  run("npx", ["next", "build"], { cwd: ROOT });

  rmSync(RESOURCES_DIR, { recursive: true, force: true });
  mkdirSync(RESOURCES_DIR, { recursive: true });
  cpSync(path.join(ROOT, ".next", "standalone"), RESOURCES_DIR, { recursive: true });
  cpSync(path.join(ROOT, ".next", "static"), path.join(RESOURCES_DIR, ".next", "static"), { recursive: true });
  if (existsSync(path.join(ROOT, "public"))) {
    cpSync(path.join(ROOT, "public"), path.join(RESOURCES_DIR, "public"), { recursive: true });
  }
}

function copyNodeSidecar(triple) {
  mkdirSync(BIN_DIR, { recursive: true });
  const suffix = process.platform === "win32" ? ".exe" : "";
  copyFileSync(process.execPath, path.join(BIN_DIR, `node-${triple}${suffix}`));
}

const triple = targetTriple();
buildNextStandalone();
copyNodeSidecar(triple);
console.log(`desktop resources prepared for ${triple}`);
