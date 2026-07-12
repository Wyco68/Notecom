import type { Env } from "./types";

const API = "https://api.github.com";

function headers(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "User-Agent": "content-api-worker",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function gh(env: Env, path: string, accept: string): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    headers: { ...headers(env), Accept: accept },
  });
  if (!res.ok) {
    throw new Error(`github ${res.status} on ${path}`);
  }
  return res;
}

export async function getBranchHead(env: Env): Promise<string> {
  const res = await gh(
    env,
    `/repos/${env.GITHUB_REPO}/branches/${env.GITHUB_BRANCH}`,
    "application/vnd.github+json"
  );
  const data = (await res.json()) as { commit: { sha: string } };
  return data.commit.sha;
}

export interface TreeBlob {
  path: string;
  sha: string;
}

export async function getTree(env: Env, sha: string): Promise<TreeBlob[]> {
  const res = await gh(
    env,
    `/repos/${env.GITHUB_REPO}/git/trees/${sha}?recursive=1`,
    "application/vnd.github+json"
  );
  const data = (await res.json()) as {
    truncated: boolean;
    tree: { path: string; sha: string; type: string }[];
  };
  if (data.truncated) {
    // >100k entries — far beyond any realistic vault; refuse rather than
    // silently sync a partial tree.
    throw new Error("github tree listing truncated");
  }
  return data.tree
    .filter((t) => t.type === "blob")
    .map((t) => ({ path: t.path, sha: t.sha }));
}

export async function getRawFile(env: Env, path: string, ref: string): Promise<string> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const res = await gh(
    env,
    `/repos/${env.GITHUB_REPO}/contents/${encoded}?ref=${ref}`,
    "application/vnd.github.raw+json"
  );
  return res.text();
}
