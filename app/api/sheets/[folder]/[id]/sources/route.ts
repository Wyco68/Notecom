import { NextRequest, NextResponse } from "next/server";
import { rm, writeFile } from "fs/promises";
import path from "path";
import { startSheetEdit } from "@/lib/generate/sheet";
import { convertLegacyOffice, isLegacyOffice } from "@/lib/generate/convert";
import { writeSheetInputs } from "@/lib/sheet/inputs";
import { openStoredSheet } from "@/lib/sheet/stored";
import type { SourceRef } from "@/lib/sheet/layout";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_REFS = 40;
const MAX_NOTE = 2000;
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Add sources to an existing sheet: documents from its folder (quizzes,
// lessons outside its range) and uploaded files (slides, handouts). One edit
// run folds what they say into the sheet. Picked documents are kept with the
// sheet, so later edits and reviews read them too; uploads are used for this
// change only, since the app stores no files.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ folder: string; id: string }> }
) {
  const { folder, id } = await params;
  if (Number(req.headers.get("content-length")) > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "files too large: keep them under 50 MB together" }, { status: 400 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "the upload did not arrive whole — try again" }, { status: 400 });
  }
  let picked: unknown;
  try {
    picked = JSON.parse(String(form.get("refs") ?? "[]"));
  } catch {
    return NextResponse.json({ error: "invalid documents list" }, { status: 400 });
  }
  const refs: Array<Pick<SourceRef, "kind" | "id">> = Array.isArray(picked)
    ? picked
        .filter((r: any) => (r?.kind === "lesson" || r?.kind === "quiz") && typeof r?.id === "string" && DOC_ID.test(r.id))
        .slice(0, MAX_REFS)
        .map((r: any) => ({ kind: r.kind, id: r.id }))
    : [];
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const note = String(form.get("note") ?? "").trim().slice(0, MAX_NOTE);
  if (!refs.length && !files.length) {
    return NextResponse.json({ error: "pick a document or upload a file to add" }, { status: 400 });
  }
  if (files.reduce((n, f) => n + f.size, 0) > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "files too large: keep them under 50 MB together" }, { status: 400 });
  }

  const sheet = await openStoredSheet(req, folder, id);
  if (sheet instanceof NextResponse) return sheet;
  const { spec } = sheet.meta;
  const kept = spec.extra ?? [];
  const fresh = refs.filter((r) => !kept.some((k) => k.kind === r.kind && k.id === r.id));
  const inputs = await writeSheetInputs(folder, spec.from, spec.to, [
    ...kept,
    ...fresh.map((r) => ({ ...r, title: r.id })),
  ]);
  if (!inputs) return NextResponse.json({ error: "its lessons are no longer in the folder" }, { status: 409 });
  const added = inputs.docs.filter((d) => fresh.some((r) => r.kind === d.ref.kind && r.id === d.ref.id)).map((d) => d.ref);
  if (fresh.length && !added.length && !files.length) {
    await rm(inputs.dir, { recursive: true, force: true });
    return NextResponse.json({ error: "none of the picked documents could be read" }, { status: 404 });
  }

  const uploads: string[] = [];
  for (const [i, f] of files.entries()) {
    const file = path.join(inputs.dir, `upload-${i + 1}-${f.name.replace(/[^\w.-]/g, "_")}`);
    await writeFile(file, Buffer.from(await f.arrayBuffer()));
    if (!isLegacyOffice(f.name)) {
      uploads.push(file);
      continue;
    }
    try {
      uploads.push(await convertLegacyOffice(file, f.name));
    } catch (err: any) {
      await rm(inputs.dir, { recursive: true, force: true });
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
  }

  const names = [...added.map((r) => `${r.kind} "${r.title}"`), ...files.map((f) => `file "${f.name}"`)];
  const request =
    `Add what these new sources say to the sheet, in the chapter each fact belongs to: ${names.join(", ")}.` +
    (note ? `\n\n${note}` : "");
  const job = startSheetEdit({
    folder,
    spec,
    inputs,
    uploads,
    userId: sheet.userId,
    docKey: id,
    html: sheet.html,
    request,
    history: sheet.meta.messages,
    addRefs: added,
  });
  return NextResponse.json({ jobId: job.id, sheet: job.sheet, step: job.step });
}
