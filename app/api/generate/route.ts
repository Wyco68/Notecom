import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { listJobs, startJob } from "@/lib/generate/runner";
import { cliInstalled } from "@/lib/auth/cli";
import { resolveWritableFolderId } from "@/lib/vault/store";
import { VERIFIED_USER_HEADER } from "@/middleware";

const KINDS = new Set(["lect", "quiz"]);
// Folder lands in a CLI prompt and a filesystem path, so it gets the same
// segment guard the vault importer applies.
const SAFE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
// A lecture upload is slides or a scanned PDF, not a video — 50MB comfortably
// covers a dense, image-heavy slide deck. This bounds what gets written to
// local temp storage and handed to the CLI, not what gets buffered in memory
// while parsing: the Content-Length check below catches a request that's
// honest about its size before formData() ever reads the body, but a request
// that lies (chunked transfer, a false Content-Length) still gets fully
// parsed before the file.size check below can reject it — same as any
// multipart upload without a streaming parser in front of it. Reserved for a
// signed-in, rate-limited caller (5/hour via middleware.ts's GENERATE_LIMIT),
// so the exploitable window for that gap is narrow.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// Jobs this server process is tracking, scoped to the caller — a generation
// run outlives the dialog that started it and even a page reload, so the
// client needs a way to find one still in flight and re-attach to its stream
// instead of orphaning it, but that's "find mine again", not "list everyone's".
export async function GET(req: NextRequest) {
  const userId = req.headers.get(VERIFIED_USER_HEADER);
  if (!userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  return NextResponse.json({ jobs: listJobs(userId) });
}

export async function POST(req: NextRequest) {
  const userId = req.headers.get(VERIFIED_USER_HEADER);
  if (!userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  // Belt and braces: startJob's own ENOENT handling already fails a run with
  // no local `claude`, but that's after a file upload and a temp-file write.
  // Reject before doing either — this is capability, not a config toggle: a
  // box with no CLI on PATH can never generate, on this request or the next.
  if (!cliInstalled()) {
    return NextResponse.json(
      { error: "no Claude Code CLI on this server — generate from the desktop app or your own checkout instead" },
      { status: 501 }
    );
  }

  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `file too large: keep it under ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB` },
      { status: 400 }
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  const folder = String(form.get("folder") ?? "");
  const kind = String(form.get("kind") ?? "");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `file too large: keep it under ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB` },
      { status: 400 }
    );
  }
  if (!SAFE.test(folder) || !KINDS.has(kind)) {
    return NextResponse.json({ error: "invalid folder or kind" }, { status: 400 });
  }

  // The spawned CLI writes to this folder on disk with no RLS in front of
  // it — the database only ever sees the import step afterward, by which
  // point the file already exists. Folder slugs are unique per owner, not
  // globally, so without this check a caller could name another owner's
  // folder and have the CLI write inside it. Same "not found" either way as
  // every other folder lookup in this app, so a probe can't tell "no such
  // folder" from "not yours".
  if (!(await resolveWritableFolderId(folder))) {
    return NextResponse.json({ error: "folder not found" }, { status: 404 });
  }

  const dir = path.join(tmpdir(), "notes-uploads");
  await mkdir(dir, { recursive: true });
  const safeName = file.name.replace(/[^\w.-]/g, "_");
  const filePath = path.join(dir, `${Date.now()}-${safeName}`);
  await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

  const job = startJob(folder, kind as "lect" | "quiz", filePath, file.name, userId);
  return NextResponse.json({ jobId: job.id });
}
