import { NextRequest, NextResponse } from "next/server";
import { startSheetEdit } from "@/lib/generate/sheet";
import { writeSheetInputs } from "@/lib/sheet/inputs";
import { openStoredSheet } from "@/lib/sheet/stored";

const MAX_MESSAGE = 4000;

// The sheet's chat box, and the "fix these" buttons, which send their list as
// a message: one edit run over the whole sheet, on sources read afresh. The
// new version is saved as soon as its markup is safe; what else the checks
// find is saved with it, never a reason to lose the change.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ folder: string; id: string }> }
) {
  const { folder, id } = await params;
  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE) {
    return NextResponse.json({ error: `write a message of up to ${MAX_MESSAGE} characters` }, { status: 400 });
  }
  const sheet = await openStoredSheet(req, folder, id);
  if (sheet instanceof NextResponse) return sheet;
  const { spec } = sheet.meta;
  const inputs = await writeSheetInputs(folder, spec.from, spec.to, spec.extra);
  if (!inputs) return NextResponse.json({ error: "its lessons are no longer in the folder" }, { status: 409 });

  const job = startSheetEdit({
    folder,
    spec,
    inputs,
    uploads: [],
    userId: sheet.userId,
    docKey: id,
    html: sheet.html,
    request: message,
    history: sheet.meta.messages,
  });
  return NextResponse.json({ jobId: job.id, sheet: job.sheet, step: job.step });
}
