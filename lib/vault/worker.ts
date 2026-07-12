// Read-only Cloudflare Worker adapter for the vault.
//
// Used ONLY when VAULT_SOURCE=worker — the Vercel deployment backed by the
// content-api Worker (workers/content-api, docs/deploy-cloudflare-github.md).
// The Worker mirrors the private lecture-content GitHub repo into KV and
// serves the same shapes as the GCS adapter, so this file is just a thin
// authenticated fetch.

import type { TreeFolder } from "./helper";
import type { GcsSearchResult } from "./gcs";

const API_URL = (process.env.CONTENT_API_URL || "").replace(/\/+$/, "");
const API_TOKEN = process.env.CONTENT_API_TOKEN || "";

async function call(path: string): Promise<any> {
  if (!API_URL) throw new Error("CONTENT_API_URL is not set");
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `content-api ${res.status}`);
  }
  return data;
}

export function workerListTree(): Promise<{ folders: TreeFolder[] }> {
  return call("/tree");
}

export function workerLoadDoc(
  folder: string,
  id: string
): Promise<{ html: string; title: string }> {
  return call(`/doc/${encodeURIComponent(folder)}/${encodeURIComponent(id)}`);
}

export function workerSearch(
  q: string,
  limit = 12
): Promise<{ mode: "keyword"; results: GcsSearchResult[] }> {
  return call(`/search?q=${encodeURIComponent(q)}&limit=${limit}`);
}
