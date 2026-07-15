import { getLoginSession } from "@/lib/auth/cli";

// SSE tail of the in-flight sign-in: log lines, the OAuth URL once the CLI
// prints it, a flag when it wants a pasted code, then end. Mirrors the
// generate job stream so the client-side handling is the same shape.
export async function GET() {
  const s = getLoginSession();
  if (!s) {
    return Response.json({ error: "no login in progress" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let sent = 0;
      let lastMeta = "";
      const send = (event: string, data: unknown) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );

      const tick = () => {
        while (sent < s.log.length) {
          send("line", { line: s.log[sent] });
          sent++;
        }
        const meta = JSON.stringify({ url: s.url, awaitingCode: s.awaitingCode });
        if (meta !== lastMeta) {
          lastMeta = meta;
          send("meta", { url: s.url, awaitingCode: s.awaitingCode });
        }
        if (s.status !== "running") {
          send("end", { status: s.status });
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
