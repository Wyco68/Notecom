import { NextRequest, NextResponse } from "next/server";
import { startSheetReview } from "@/lib/generate/sheet";
import { writeSheetInputs } from "@/lib/sheet/inputs";
import { openStoredSheet } from "@/lib/sheet/stored";

// The independent review, chapter by chapter: a fresh session checks one
// chapter's section against its sources per run, and each chapter's findings
// are saved as they come. By default only chapters not yet reviewed since
// they last changed; `{ all: true }` checks every one again.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ folder: string; id: string }> }
) {
  const { folder, id } = await params;
  const body = await req.json().catch(() => ({}));
  const sheet = await openStoredSheet(req, folder, id);
  if (sheet instanceof NextResponse) return sheet;
  const { spec } = sheet.meta;
  const inputs = await writeSheetInputs(folder, spec.from, spec.to, spec.extra);
  if (!inputs) return NextResponse.json({ error: "its lessons are no longer in the folder" }, { status: 409 });

  const reviewed = sheet.meta.review?.reviewed ?? [];
  const order = inputs.chapters.map((c) => c.seq).filter((seq) => body?.all || !reviewed.includes(seq));
  if (!order.length) return NextResponse.json({ error: "every chapter is already reviewed" }, { status: 409 });

  const job = startSheetReview({
    folder,
    spec,
    inputs,
    userId: sheet.userId,
    docKey: id,
    html: sheet.html,
    order,
  });
  return NextResponse.json({ jobId: job.id, sheet: job.sheet, step: job.step });
}
