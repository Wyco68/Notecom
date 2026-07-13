import { NextRequest } from "next/server";

const INDEXD_URL = process.env.INDEXD_URL || "http://127.0.0.1:4322";
const INDEXD_TOKEN = process.env.INDEXD_TOKEN;

// Streaming passthrough to indexd's SSE chat endpoint — the app adds no
// AI logic of its own (see SPECIFICATION.md §2.3a).
export async function POST(req: NextRequest) {
  let upstream: Response;
  try {
    upstream = await fetch(`${INDEXD_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(INDEXD_TOKEN ? { "X-Auth-Token": INDEXD_TOKEN } : {}),
      },
      body: JSON.stringify(await req.json()),
      cache: "no-store",
    });
  } catch {
    return Response.json({ error: "search service is offline" }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    const data = await upstream.json().catch(() => ({}));
    return Response.json(
      { error: (data as any).error || `indexd ${upstream.status}` },
      { status: upstream.status }
    );
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
