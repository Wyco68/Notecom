import { NextRequest, NextResponse } from "next/server";
import { startSheetJob } from "@/lib/generate/runner";
import { cliInstalled } from "@/lib/auth/cli";
import { loadDoc, resolveWritableFolderId } from "@/lib/vault/store";
import { writeChapters } from "@/lib/sheet/inputs";
import type { SheetMeta } from "@/lib/sheet/layout";
import { VERIFIED_USER_HEADER } from "@/middleware";

const MAX_MESSAGE = 4000;

// The sheet's chat box: one message from the reader becomes an edit run.
// Claude gets the current sheet, the message, the conversation so far and the
// chapters read afresh as the caller; the new version goes through every
// check and the review, and is saved over the old one with both turns added
// to the conversation. Spends tokens, so it shares generation's rate limit.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ folder: string; id: string }> }
) {
  const userId = req.headers.get(VERIFIED_USER_HEADER);
  if (!userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  if (!cliInstalled()) {
    return NextResponse.json(
      { error: "no Claude Code CLI on this server — edit cheatsheets from the desktop app instead" },
      { status: 501 }
    );
  }
  const { folder, id } = await params;
  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE) {
    return NextResponse.json({ error: `write a message of up to ${MAX_MESSAGE} characters` }, { status: 400 });
  }

  // The edit is saved over the sheet; check write access before a run spends
  // minutes and tokens. Not found either way, as for every folder lookup.
  if (!(await resolveWritableFolderId(folder))) {
    return NextResponse.json({ error: "cheatsheet not found" }, { status: 404 });
  }
  let doc: Awaited<ReturnType<typeof loadDoc>>;
  try {
    doc = await loadDoc(folder, id, "sheet");
  } catch {
    return NextResponse.json({ error: "cheatsheet not found" }, { status: 404 });
  }
  const meta = doc.meta as SheetMeta | null;
  if (!meta?.spec) return NextResponse.json({ error: "this cheatsheet has no chapter range to edit from" }, { status: 409 });

  const inputs = await writeChapters(folder, meta.spec.from, meta.spec.to);
  if (!inputs) return NextResponse.json({ error: "its lessons are no longer in the folder" }, { status: 409 });

  const job = startSheetJob(folder, meta.spec, inputs.dir, inputs.chapters, [], userId, {
    docKey: id,
    request: message,
    current: doc.html,
    history: meta.messages ?? [],
  });
  return NextResponse.json({ jobId: job.id, sheet: job.sheet });
}
