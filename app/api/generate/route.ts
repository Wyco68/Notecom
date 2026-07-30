import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { listJobs, startJob } from "@/lib/generate/runner";

const KINDS = new Set(["lect", "quiz"]);
// Folder lands in a CLI prompt and a filesystem path, so it gets the same
// segment guard the vault importer applies.
const SAFE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

// Jobs this server process is tracking. A generation run outlives the dialog
// that started it and even a page reload, so the client needs a way to find one
// still in flight and re-attach to its stream instead of orphaning it.
export async function GET() {
  return NextResponse.json({ jobs: listJobs() });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const folder = String(form.get("folder") ?? "");
  const kind = String(form.get("kind") ?? "");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (!SAFE.test(folder) || !KINDS.has(kind)) {
    return NextResponse.json({ error: "invalid folder or kind" }, { status: 400 });
  }

  const dir = path.join(tmpdir(), "notes-uploads");
  await mkdir(dir, { recursive: true });
  const safeName = file.name.replace(/[^\w.-]/g, "_");
  const filePath = path.join(dir, `${Date.now()}-${safeName}`);
  await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

  const job = startJob(folder, kind as "lect" | "quiz", filePath, file.name);
  return NextResponse.json({ jobId: job.id });
}
