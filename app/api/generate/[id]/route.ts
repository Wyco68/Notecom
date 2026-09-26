import { NextRequest } from "next/server";
import { getJob, saveJob, stopJob } from "@/lib/generate/runner";
import { VERIFIED_USER_HEADER } from "@/middleware";

// SSE tail of a generation job: log lines, token-count updates, then end —
// with status "ready" when the document is waiting for the POST below.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = req.headers.get(VERIFIED_USER_HEADER);
  if (!userId) return Response.json({ error: "sign in required" }, { status: 401 });
  const { id } = await params;
  // Someone else's job reads as "not found", same as a job that never
  // existed — an id is not a permission, and this app never confirms one it
  // won't also let the caller act on.
  const job = getJob(id, userId);
  if (!job) {
    return Response.json({ error: "job not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let sent = 0;
      let lastTokens = "";
      const tick = () => {
        while (sent < job.log.length) {
          controller.enqueue(
            encoder.encode(`event: line\ndata: ${JSON.stringify({ line: job.log[sent] })}\n\n`)
          );
          sent++;
        }
        const tok = JSON.stringify(job.tokens);
        if (tok !== lastTokens) {
          lastTokens = tok;
          controller.enqueue(encoder.encode(`event: tokens\ndata: ${tok}\n\n`));
        }
        if (job.status !== "running") {
          controller.enqueue(
            encoder.encode(
              `event: end\ndata: ${JSON.stringify({
                status: job.status,
                tokens: job.tokens,
                needsAuth: !!job.needsAuth,
              })}\n\n`
            )
          );
          controller.close();
          return;
        }
        setTimeout(tick, 400);
      };
      tick();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

// Save a finished job's document to Supabase. The client calls this as soon as
// the tail ends with "ready"; it is the save's only trigger because only a
// request carries the caller's session, which RLS needs (see saveJob).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = req.headers.get(VERIFIED_USER_HEADER);
  if (!userId) return Response.json({ error: "sign in required" }, { status: 401 });
  const { id } = await params;
  const job = getJob(id, userId);
  if (!job) return Response.json({ error: "job not found" }, { status: 404 });
  if (job.status !== "ready" && !job.saved) {
    return Response.json({ error: "nothing to save" }, { status: 409 });
  }
  try {
    const saved = await saveJob(job);
    return Response.json({ ok: true, id: saved.id, title: saved.title });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}

// Force-stop a running job — the modal's Ctrl+C.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = req.headers.get(VERIFIED_USER_HEADER);
  if (!userId) return Response.json({ error: "sign in required" }, { status: 401 });
  const { id } = await params;
  const stopped = stopJob(id, userId);
  if (!stopped) {
    return Response.json({ error: "job not running" }, { status: 409 });
  }
  return Response.json({ ok: true });
}
