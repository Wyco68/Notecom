import { NextRequest } from "next/server";
import { getJob, reviseSheet } from "@/lib/generate/runner";
import { VERIFIED_USER_HEADER } from "@/middleware";

// A finished cheatsheet's HTML fragment and what it was asked for. Held by the
// server process only — a sheet is printed, never saved — so it is gone after
// a restart, and the client says so rather than pretending.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = req.headers.get(VERIFIED_USER_HEADER);
  if (!userId) return Response.json({ error: "sign in required" }, { status: 401 });
  const { id } = await params;
  const job = getJob(id, userId);
  if (!job || job.kind !== "sheet" || !job.sheet) {
    return Response.json({ error: "cheatsheet not found" }, { status: 404 });
  }
  if (job.status !== "done" || !job.html) {
    return Response.json({ error: "cheatsheet not ready" }, { status: 409 });
  }
  return Response.json({ html: job.html, folder: job.folder, sheet: job.sheet, review: job.review ?? null });
}

// The browser laid the sheet out and it fails there: still over the page
// limit at the smallest font, or the layout audit found blocks outside their
// column, overlaps or clipping. Send it back to the session that wrote it.
// Spends tokens, so it is rate-limited with generation (middleware.ts).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = req.headers.get(VERIFIED_USER_HEADER);
  if (!userId) return Response.json({ error: "sign in required" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const pages = body?.pages === undefined ? undefined : Number(body.pages);
  if (pages !== undefined && (!Number.isInteger(pages) || pages < 1 || pages > 100)) {
    return Response.json({ error: "invalid page count" }, { status: 400 });
  }
  const layout = Array.isArray(body?.layout)
    ? body.layout.filter((l: unknown): l is string => typeof l === "string").map((l: string) => l.slice(0, 200))
    : [];
  const result = reviseSheet(id, userId, { pages, layout });
  if (result === "expired") {
    return Response.json({ error: "this sheet's sources have expired — make it again" }, { status: 410 });
  }
  if (result === "nothing") return Response.json({ error: "nothing to revise" }, { status: 409 });
  return Response.json({ ok: true });
}
