import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { startJob } from "@/lib/generate/runner";
import { convertLegacyOffice, isLegacyOffice } from "@/lib/generate/convert";
import { cliInstalled } from "@/lib/auth/cli";
import { loadDoc, resolveWritableFolderId } from "@/lib/vault/store";
import { VERIFIED_USER_HEADER } from "@/middleware";

// Picture mode: the slides a saved lesson was written from, uploaded again so
// a /lect run can add their pictures to it without rewriting it (see
// lib/generate/place.ts). Same upload rules as POST /api/generate; its own
// rate budget in middleware.ts, because a course is a dozen of these.
const SAFE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const SAFE_KEY = /^[a-z0-9][a-z0-9-]*$/;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const userId = req.headers.get(VERIFIED_USER_HEADER);
  if (!userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  if (!cliInstalled()) {
    return NextResponse.json(
      { error: "no Claude Code CLI on this server — add pictures from the desktop app or your own checkout instead" },
      { status: 501 }
    );
  }
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "file too large: keep it under 50 MB" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "the upload did not arrive whole — try again" }, { status: 400 });
  }
  const file = form.get("file");
  const folder = String(form.get("folder") ?? "");
  const lesson = String(form.get("lesson") ?? "");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "missing file" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "file too large: keep it under 50 MB" }, { status: 400 });
  if (!SAFE.test(folder) || !SAFE_KEY.test(lesson)) {
    return NextResponse.json({ error: "invalid folder or lesson" }, { status: 400 });
  }
  if (!(await resolveWritableFolderId(folder))) return NextResponse.json({ error: "folder not found" }, { status: 404 });

  // Read now, as the caller: the run outlives this request, and only a request
  // carries the session the read needs.
  let current: { html: string; title: string };
  try {
    current = await loadDoc(folder, lesson, "lesson");
  } catch {
    return NextResponse.json({ error: "lesson not found" }, { status: 404 });
  }

  const dir = path.join(tmpdir(), "notes-uploads");
  await mkdir(dir, { recursive: true });
  let filePath = path.join(dir, `${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`);
  await writeFile(filePath, Buffer.from(await file.arrayBuffer()));
  let fileName = file.name;
  if (isLegacyOffice(file.name)) {
    try {
      filePath = await convertLegacyOffice(filePath, file.name);
      fileName = file.name.replace(/\.\w+$/, path.extname(filePath));
    } catch (err: any) {
      await rm(filePath, { force: true });
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
  }

  const job = startJob(folder, "lect", filePath, fileName, userId, { docKey: lesson, title: current.title, html: current.html });
  return NextResponse.json({ jobId: job.id });
}
