import { NextRequest, NextResponse } from "next/server";
import { VERIFIED_USER_HEADER } from "@/middleware";
import { checkLesson, checkQuiz } from "@/lib/generate/validate";
import { saveGenerated } from "@/lib/generate/save";
import { resolveWritableFolderId } from "@/lib/vault/store";

const SAFE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
// A lesson is tens of KB; a quarter of the platform's request limit leaves
// room for any real one and none for abuse.
const MAX_HTML_BYTES = 1024 * 1024;

// Saves a lesson or quiz a web service wrote in the reader's browser. The
// browser already ran the contract check; it runs again here, because the
// request is the reader's and only the server's check counts. The save goes
// through RLS as the caller, like every other write.
export async function POST(req: NextRequest) {
  const userId = req.headers.get(VERIFIED_USER_HEADER);
  if (!userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) {
    return NextResponse.json({ error: "document too large" }, { status: 413 });
  }
  const body = await req.json().catch(() => null);
  const folder = String(body?.folder ?? "");
  const kind = body?.kind;
  const html = body?.html;
  if (!SAFE.test(folder) || (kind !== "lect" && kind !== "quiz") || typeof html !== "string" || !html) {
    return NextResponse.json({ error: "invalid folder, kind or document" }, { status: 400 });
  }
  if (html.length > MAX_HTML_BYTES) return NextResponse.json({ error: "document too large" }, { status: 413 });

  const violations = kind === "quiz" ? checkQuiz(html) : checkLesson(html);
  if (violations.length) {
    return NextResponse.json({ error: "the document fails the output contract", violations }, { status: 422 });
  }
  if (!(await resolveWritableFolderId(folder))) {
    return NextResponse.json({ error: "folder not found" }, { status: 404 });
  }
  try {
    const saved = await saveGenerated(folder, kind, html);
    return NextResponse.json({ ok: true, ...saved });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "save failed" }, { status: 500 });
  }
}
