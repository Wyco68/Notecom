// Tauri's build.rs (via tauri-build) requires every `bundle.externalBin`
// entry to exist on disk *at compile time*, even for `tauri dev` — which
// never actually runs them, since dev mode talks to a plain local vaultd +
// `npm run dev`, not the sidecars (see desktop/src/lib.rs's `dev` module).
// This just satisfies that existence check with empty placeholder files
// instead of paying for a full production build on every `tauri dev`.

import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { targetTriple } from "./desktop-target-triple.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN_DIR = path.join(ROOT, "desktop", "bin");
const RESOURCES_DIR = path.join(ROOT, "desktop", "resources", "frontend");
const suffix = process.platform === "win32" ? ".exe" : "";
const triple = targetTriple();

mkdirSync(BIN_DIR, { recursive: true });
for (const name of ["vaultd", "indexd", "node"]) {
  const file = path.join(BIN_DIR, `${name}-${triple}${suffix}`);
  if (!existsSync(file)) writeFileSync(file, "");
}

// bundle.resources is a glob (`resources/frontend/**/*`) that tauri-build
// requires to match at least one file at compile time, even though dev mode
// never reads it (only the release sidecar path does).
mkdirSync(RESOURCES_DIR, { recursive: true });
const placeholder = path.join(RESOURCES_DIR, ".gitkeep");
if (!existsSync(placeholder)) writeFileSync(placeholder, "");
