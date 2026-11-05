import { NextRequest, NextResponse } from "next/server";
import { VERIFIED_USER_HEADER } from "@/middleware";
import { systemPrompt } from "@/lib/generate/template";

// The system prompt a web-service run sends: the template docs /lect and /quiz
// load. Served to the browser, which talks to the service itself — the docs
// live on the server, the reader's key never does.
export async function GET(req: NextRequest) {
  const userId = req.headers.get(VERIFIED_USER_HEADER);
  if (!userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const kind = req.nextUrl.searchParams.get("kind");
  if (kind !== "lect" && kind !== "quiz") {
    return NextResponse.json({ error: "kind must be lect or quiz" }, { status: 400 });
  }
  try {
    return NextResponse.json({ system: systemPrompt(kind) }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    return NextResponse.json({ error: "the template couldn't be read on this server" }, { status: 500 });
  }
}
