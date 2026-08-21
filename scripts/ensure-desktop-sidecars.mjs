// Tauri's build.rs (via tauri-build) requires every `bundle.externalBin`
// entry to exist on disk *at compile time*, even for `tauri dev` — which
// never actually runs it, since dev mode spawns `npm run dev` directly rather
// than the bundled Node sidecar (see desktop/src/lib.rs's `dev` module).
// This just satisfies that existence check with empty placeholder files
// instead of paying for a full production build on every `tauri dev`.

import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { targetTriple } from "./desktop-target-triple.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN_DIR = path.join(ROOT, "desktop", "bin");
const RESOURCES_DIR = path.join(ROOT, "desktop", "resources", "frontend");
const CLAUDE_PROJECT_DIR = path.join(ROOT, "desktop", "resources", "claude-project");
const suffix = process.platform === "win32" ? ".exe" : "";
const triple = targetTriple();

mkdirSync(BIN_DIR, { recursive: true });
for (const name of ["node"]) {
  const file = path.join(BIN_DIR, `${name}-${triple}${suffix}`);
  if (!existsSync(file)) writeFileSync(file, "");
}

// bundle.resources is a glob (`resources/frontend/**/*`, `resources/
// claude-project/**/*`) that tauri-build requires to match at least one file
// at compile time, even though dev mode never reads either (only the release
// sidecar path does).
for (const dir of [RESOURCES_DIR, CLAUDE_PROJECT_DIR]) {
  mkdirSync(dir, { recursive: true });
  const placeholder = path.join(dir, ".gitkeep");
  if (!existsSync(placeholder)) writeFileSync(placeholder, "");
}
