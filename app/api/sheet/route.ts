import { NextRequest, NextResponse } from "next/server";
import { rm, writeFile } from "fs/promises";
import path from "path";
import { startSheetWrite } from "@/lib/generate/sheet";
import { convertLegacyOffice, isLegacyOffice } from "@/lib/generate/convert";
import { cliInstalled } from "@/lib/auth/cli";
import { resolveWritableFolderId } from "@/lib/vault/store";
import { writeChapters } from "@/lib/sheet/inputs";
import { layoutFor, MAX_COLUMNS, MAX_PAGES, MIN_COLUMNS } from "@/lib/sheet/layout";
import { VERIFIED_USER_HEADER } from "@/middleware";

// A folder slug, never free text — the shape every folder slug has.
const SAFE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
// Slides for the sheet to check the notes against. Same bound as a Generate
// upload, across all of them.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_CHAPTERS = 40;

// Start a cheatsheet run over a range of a folder's lessons. The chapters are
// read here, as the caller under RLS, and handed to the CLI as files
// (lib/sheet/inputs.ts). The run is followed, stopped and — once it ends
// "ready" — saved into the folder through /api/generate/[id], like any job.
export async function POST(req: NextRequest) {
  const userId = req.headers.get(VERIFIED_USER_HEADER);
  if (!userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  if (!cliInstalled()) {
    return NextResponse.json(
      { error: "no Claude Code CLI on this server — make cheatsheets from the desktop app or your own checkout instead" },
      { status: 501 }
    );
  }

  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "files too large: keep them under 50 MB together" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    // A body that ended early (dropped connection, a proxy's size cap) is not
    // multipart any more; answer in JSON like every other failure here.
    return NextResponse.json({ error: "the upload did not arrive whole — try again" }, { status: 400 });
  }
  const folder = String(form.get("folder") ?? "");
  const from = Number(form.get("from"));
  const to = Number(form.get("to"));
  const pages = Number(form.get("pages"));
  // Optional: absent or empty means the page size's own column count.
  const columnsRaw = String(form.get("columns") ?? "").trim();
  const columns = columnsRaw ? Number(columnsRaw) : undefined;
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

  if (!SAFE.test(folder)) return NextResponse.json({ error: "invalid folder" }, { status: 400 });
  // pages 0 = no page limit.
  if (![from, to, pages].every(Number.isInteger) || from < 1 || to < from || pages < 0 || pages > MAX_PAGES) {
    return NextResponse.json({ error: "invalid chapter range or page limit" }, { status: 400 });
  }
  if (columns !== undefined && !(Number.isInteger(columns) && columns >= MIN_COLUMNS && columns <= MAX_COLUMNS)) {
    return NextResponse.json({ error: `columns must be ${MIN_COLUMNS} to ${MAX_COLUMNS}` }, { status: 400 });
  }
  if (to - from + 1 > MAX_CHAPTERS) {
    return NextResponse.json({ error: `at most ${MAX_CHAPTERS} chapters per sheet` }, { status: 400 });
  }
  if (files.reduce((n, f) => n + f.size, 0) > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "files too large: keep them under 50 MB together" }, { status: 400 });
  }

  // The sheet is saved into this folder when it is done, under RLS like any
  // write — check before a run spends minutes and real tokens, with the same
  // function RLS calls. Same "not found" either way, so a probe learns nothing.
  if (!(await resolveWritableFolderId(folder))) {
    return NextResponse.json({ error: "folder not found" }, { status: 404 });
  }
  const inputs = await writeChapters(folder, from, to);
  if (!inputs) return NextResponse.json({ error: "no lessons in that range" }, { status: 404 });
  const { dir, chapters, first, last } = inputs;
  const extras: string[] = [];
  for (const [i, f] of files.entries()) {
    const file = path.join(dir, `source-${i + 1}-${f.name.replace(/[^\w.-]/g, "_")}`);
    await writeFile(file, Buffer.from(await f.arrayBuffer()));
    if (!isLegacyOffice(f.name)) {
      extras.push(file);
      continue;
    }
    try {
      extras.push(await convertLegacyOffice(file, f.name));
    } catch (err: any) {
      await rm(dir, { recursive: true, force: true });
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
  }

  const job = startSheetWrite({
    folder,
    spec: {
      from: first,
      to: last,
      pages,
      layout: layoutFor(pages),
      // Columns are a choice only without a page limit; a limited sheet's are fitted.
      ...(columns && !pages ? { columns } : {}),
      title: `${folder}-cheatsheet-ch${first}-${last}`,
    },
    inputs,
    uploads: extras,
    userId,
    order: chapters.map((c) => c.seq),
  });
  return NextResponse.json({ jobId: job.id, sheet: job.sheet, step: job.step });
}
