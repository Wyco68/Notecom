// What every step on a stored cheatsheet checks before it spends anything:
// the caller is signed in, this machine has the CLI, the caller may write the
// folder (the step saves into it), the sheet exists and carries a spec, and no
// other step is already running on it. Returns the sheet, or the response to
// send instead.

import { NextRequest, NextResponse } from "next/server";
import { activeSheetStep } from "@/lib/generate/runner";
import { cliInstalled } from "@/lib/auth/cli";
import { loadDoc, resolveWritableFolderId } from "@/lib/vault/store";
import { reviewOf, type SheetMeta } from "./layout";
import { VERIFIED_USER_HEADER } from "@/middleware";

export interface StoredSheet {
  userId: string;
  html: string;
  title: string;
  meta: SheetMeta;
}

export async function openStoredSheet(
  req: NextRequest,
  folder: string,
  id: string
): Promise<StoredSheet | NextResponse> {
  const userId = req.headers.get(VERIFIED_USER_HEADER);
  if (!userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  if (!cliInstalled()) {
    return NextResponse.json(
      { error: "no Claude Code CLI on this server — work on cheatsheets from the desktop app instead" },
      { status: 501 }
    );
  }
  // Not found either way, as for every folder lookup: a probe learns nothing.
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
  if (!meta?.spec) {
    return NextResponse.json({ error: "this cheatsheet has no chapter range to work from" }, { status: 409 });
  }
  if (activeSheetStep(userId, folder, id)) {
    return NextResponse.json({ error: "this cheatsheet is already being worked on — wait for that to finish" }, { status: 409 });
  }
  return {
    userId,
    html: doc.html,
    title: doc.title,
    meta: { ...meta, review: reviewOf(meta), messages: meta.messages ?? [] },
  };
}
