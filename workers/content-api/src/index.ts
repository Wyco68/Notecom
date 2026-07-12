import { search } from "./search";
import { syncFromGitHub } from "./sync";
import type { Env, Manifest } from "./types";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const encoder = new TextEncoder();

function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  // Cloudflare Workers extension; constant-time.
  return (crypto.subtle as any).timingSafeEqual(ab, bb);
}

function bearerOk(req: Request, env: Env): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  return env.API_TOKEN.length > 0 && timingSafeEqual(auth, `Bearer ${env.API_TOKEN}`);
}

async function webhookSignatureOk(env: Env, body: string, header: string | null): Promise<boolean> {
  if (!header || !env.WEBHOOK_SECRET) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(header, `sha256=${hex}`);
}

// Folder names and ids are single path segments (kebab-case slugs); reject
// anything else before it reaches a KV key.
function safeSegment(s: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(s) && !s.startsWith(".");
}

async function handleWebhook(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await req.text();
  const ok = await webhookSignatureOk(env, body, req.headers.get("X-Hub-Signature-256"));
  if (!ok) return json({ error: "bad signature" }, 401);
  if (req.headers.get("X-GitHub-Event") !== "push") return json({ ignored: true });
  let payload: { ref?: string; after?: string };
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ error: "bad payload" }, 400);
  }
  if (payload.ref !== `refs/heads/${env.GITHUB_BRANCH}`) return json({ ignored: true });
  const after = payload.after ?? "";
  if (!after || /^0+$/.test(after)) return json({ ignored: true });
  ctx.waitUntil(syncFromGitHub(env, after).catch((err) => console.error("webhook sync", err)));
  return json({ ok: true });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "POST" && path === "/webhook") {
      return handleWebhook(req, env, ctx);
    }

    if (!bearerOk(req, env)) return json({ error: "unauthorized" }, 401);

    if (req.method === "POST" && path === "/sync") {
      ctx.waitUntil(syncFromGitHub(env).catch((err) => console.error("sync", err)));
      return json({ started: true }, 202);
    }

    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

    if (path === "/tree") {
      const tree = await env.CONTENT.get("tree");
      return new Response(tree ?? JSON.stringify({ folders: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (path === "/status") {
      const manifest = await env.CONTENT.get<Manifest>("manifest", "json");
      const docCount = manifest
        ? Object.keys(manifest.files).filter((p) => p.endsWith(".html")).length
        : 0;
      return json({
        ok: true,
        commitSha: manifest?.commitSha ?? null,
        syncedAt: manifest?.syncedAt ?? null,
        docCount,
      });
    }

    if (path === "/search") {
      const q = url.searchParams.get("q") ?? "";
      const limit = Number(url.searchParams.get("limit") ?? "12") || 12;
      return json(await search(env, q, Math.min(limit, 50)));
    }

    const doc = /^\/doc\/([^/]+)\/([^/]+)$/.exec(path);
    if (doc) {
      const folder = decodeURIComponent(doc[1]);
      const id = decodeURIComponent(doc[2]);
      if (!safeSegment(folder) || !safeSegment(id)) return json({ error: "bad path" }, 400);
      const { value, metadata } = await env.CONTENT.getWithMetadata<{ title?: string }>(
        `doc:${folder}/${id}`
      );
      if (value === null) return json({ error: "not found" }, 404);
      return json({ html: value, title: metadata?.title || id });
    }

    return json({ error: "not found" }, 404);
  },
};
