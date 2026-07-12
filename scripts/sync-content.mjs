// Publish the local vault/ to the private lecture-content GitHub repo that
// feeds the Cloudflare Worker deployment (docs/deploy-cloudflare-github.md).
//
//   npm run sync:content
//
// Git state lives in .content-git/ (gitignored) with vault/ as a detached
// work tree, so no .git/ ever appears inside vault/ and the GCS rsync flow
// is unaffected. The push triggers the content repo's webhook, which makes
// the Worker re-sync — nothing else to run.
//
// First run needs CONTENT_REPO_URL (e.g. git@github.com:you/lecture-content.git
// or https://github.com/you/lecture-content.git). CONTENT_BRANCH defaults to
// "main".

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const GIT_DIR = path.join(ROOT, ".content-git");
const WORK_TREE = path.join(ROOT, "vault");
const BRANCH = process.env.CONTENT_BRANCH || "main";

function git(args, opts = {}) {
  const res = spawnSync(
    "git",
    [`--git-dir=${GIT_DIR}`, `--work-tree=${WORK_TREE}`, ...args],
    { cwd: WORK_TREE, encoding: "utf8", ...opts }
  );
  if (res.error) throw res.error;
  return res;
}

function gitOk(args) {
  const res = git(args);
  if (res.status !== 0) {
    throw new Error(`git ${args[0]} failed:\n${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootstrap() {
  const url = process.env.CONTENT_REPO_URL;
  if (!url) {
    console.error(
      "CONTENT_REPO_URL is not set and .content-git/ does not exist yet.\n" +
        "Set it to the lecture-content repo remote for the first run, e.g.\n" +
        "  CONTENT_REPO_URL=git@github.com:you/lecture-content.git npm run sync:content"
    );
    process.exit(1);
  }
  gitOk(["init", "-b", BRANCH]);
  gitOk(["remote", "add", "origin", url]);
  // Derived local data stays out of the content repo: indexd's SQLite dir
  // and the quiz answer state (would churn a commit per quiz answer).
  await mkdir(path.join(GIT_DIR, "info"), { recursive: true });
  await writeFile(path.join(GIT_DIR, "info", "exclude"), ".index/\n.quiz-state.json\n");
  const fetch = git(["fetch", "origin", BRANCH]);
  if (fetch.status === 0) {
    // Adopt remote history; --mixed moves HEAD/index only, never vault/ files.
    gitOk(["reset", "--mixed", `origin/${BRANCH}`]);
  }
}

function commitMessage() {
  const lines = gitOk(["diff", "--cached", "--name-status"])
    .split("\n")
    .filter(Boolean);
  const counts = new Map(); // "folder|verb" -> n
  let indexRebuilt = false;
  for (const line of lines) {
    const [status, file] = line.split("\t");
    if (file === ".search-index.json") {
      indexRebuilt = true;
      continue;
    }
    const folder = file.includes("/") ? file.split("/")[0] : "(root)";
    const verb = status.startsWith("A") ? "added" : status.startsWith("D") ? "removed" : "updated";
    const k = `${folder}|${verb}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([k, n]) => {
    const [folder, verb] = k.split("|");
    return `${n} ${verb} in ${folder}`;
  });
  if (indexRebuilt) parts.push("index rebuilt");
  return `sync: ${parts.join(", ") || "content update"}`;
}

async function push() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res = git(["push", "origin", BRANCH]);
    if (res.status === 0) return;
    if (/non-fast-forward|fetch first|rejected/.test(res.stderr)) {
      // The content repo is a mirror; this machine's vault is canonical.
      // force-with-lease still refuses to clobber pushes we haven't fetched.
      git(["fetch", "origin", BRANCH]);
      res = git(["push", "--force-with-lease", "origin", BRANCH]);
      if (res.status === 0) return;
    }
    console.error(`push attempt ${attempt} failed:\n${res.stderr}`);
    if (attempt < 3) await sleep(attempt * 3000);
  }
  throw new Error("push failed after 3 attempts");
}

async function main() {
  if (!existsSync(WORK_TREE)) {
    console.error("vault/ does not exist — nothing to sync.");
    process.exit(1);
  }

  console.log("rebuilding search index...");
  const idx = spawnSync(process.execPath, [path.join(ROOT, "scripts", "build-search-index.mjs")], {
    stdio: "inherit",
  });
  if (idx.status !== 0) process.exit(idx.status ?? 1);

  if (!existsSync(GIT_DIR)) await bootstrap();

  gitOk(["add", "-A"]);
  if (git(["diff", "--cached", "--quiet"]).status === 0) {
    console.log("already up to date — nothing to push.");
    return;
  }

  const msg = commitMessage();
  gitOk([
    "-c", "user.name=vault-sync",
    "-c", "user.email=vault-sync@localhost",
    "commit", "-m", msg,
  ]);
  console.log(`committed: ${msg}`);

  await push();
  console.log(`pushed ${gitOk(["rev-parse", "HEAD"])} to origin/${BRANCH}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
