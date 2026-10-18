import { NextRequest, NextResponse } from "next/server";
import { startSheetWrite } from "@/lib/generate/sheet";
import { sectionsOf } from "@/lib/generate/sheet";
import { writeSheetInputs } from "@/lib/sheet/inputs";
import { openStoredSheet } from "@/lib/sheet/stored";

// Write the chapters a sheet is still missing — the rest of a write that
// stopped part-way (out of tokens, aborted, the app closed). Each chapter is
// saved as it is written, like the first time.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ folder: string; id: string }> }
) {
  const { folder, id } = await params;
  const sheet = await openStoredSheet(req, folder, id);
  if (sheet instanceof NextResponse) return sheet;
  const { spec } = sheet.meta;
  const inputs = await writeSheetInputs(folder, spec.from, spec.to, spec.extra);
  if (!inputs) return NextResponse.json({ error: "its lessons are no longer in the folder" }, { status: 409 });

  // What the sheet says is pending, else whatever chapter has no section.
  const present = sectionsOf(sheet.html);
  const inRange = inputs.chapters.map((c) => c.seq);
  const order = (sheet.meta.pending?.length ? sheet.meta.pending : inRange).filter(
    (seq) => inRange.includes(seq) && (sheet.meta.pending?.includes(seq) || !present.has(seq))
  );
  if (!order.length) return NextResponse.json({ error: "every chapter is already written" }, { status: 409 });

  const job = startSheetWrite({
    folder,
    spec,
    inputs,
    uploads: [],
    userId: sheet.userId,
    order,
    docKey: id,
    html: sheet.html,
  });
  return NextResponse.json({ jobId: job.id, sheet: job.sheet, step: job.step });
}
