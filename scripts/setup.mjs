// One-command project setup: `npm run setup` (after `npm install`).
//
// Checks every tool the project needs, installs what it can (the
// markitdown MCP server), and prints exactly what's left to do by hand
// (claude login). Safe to re-run any time — every step is a check-then-act.
//
// No Go toolchain any more: the app talks to Supabase directly, so the three
// Go sidecars it used to build here no longer exist.

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shell = process.platform === "win32";

function tryRun(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { shell, encoding: "utf8", ...opts });
  return r.status === 0 ? (r.stdout || "").trim() : null;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { shell, stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
}

const results = [];
const todo = [];
const ok = (label, detail) => results.push(`  [ok] ${label}${detail ? ` — ${detail}` : ""}`);
const bad = (label, fix) => {
  results.push(`  [MISSING] ${label}`);
  todo.push(fix);
};

console.log("\nChecking required tools...\n");

// --- required tools ---
const nodeV = process.version;
ok("Node.js", nodeV);

const claudeV = tryRun("claude", ["--version"]);
if (claudeV) ok("Claude Code CLI", claudeV);
else
  bad(
    "Claude Code CLI (writes the notes)",
    "Run `npm install -g @anthropic-ai/claude-code`, then `claude` once to log in."
  );

// --- markitdown MCP server (file conversion for /lect) ---
const markitdown = tryRun("markitdown-mcp", ["--help"]) !== null;
if (markitdown) {
  ok("markitdown-mcp (file conversion)");
} else {
  const pip = tryRun("pip", ["--version"]) || tryRun("pip3", ["--version"]);
  if (pip) {
    console.log("  installing markitdown-mcp via pip...");
    const pipCmd = tryRun("pip", ["--version"]) ? "pip" : "pip3";
    try {
      run(pipCmd, ["install", "markitdown-mcp"]);
      ok("markitdown-mcp (file conversion)", "installed");
    } catch {
      bad("markitdown-mcp", `\`${pipCmd} install markitdown-mcp\` failed — run it by hand and check the error.`);
    }
  } else {
    bad(
      "Python/pip (needed for markitdown-mcp, which /lect uses to read PDFs/slides)",
      "Install Python 3 from https://python.org, then run `pip install markitdown-mcp`."
    );
  }
}

console.log(results.join("\n"));

if (todo.length > 0) {
  console.log("\nStill to do by hand:\n");
  todo.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
}

console.log(`
Setup ${todo.some((t) => !t.startsWith("Optional")) ? "INCOMPLETE — finish the steps above, then re-run \`npm run setup\`" : "complete"}.

Run the app:
  npm run dev            web app at http://localhost:3000/vault
  npm run dev:desktop    native window (needs Rust — see docs/desktop.md)

Write your first note: open \`claude\` in this folder, attach a PDF/slides,
type \`/lect <Subject Name>\`. Full walkthrough: docs/GETTING_STARTED.md
`);
