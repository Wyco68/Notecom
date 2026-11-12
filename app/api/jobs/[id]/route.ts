import { NextRequest, NextResponse, after } from "next/server";
import { VERIFIED_USER_HEADER } from "@/middleware";
import { cancelJob, getJob, publicJob } from "@/lib/jobs/queue";
import { endUploads } from "@/lib/jobs/run";

const ID = /^[0-9a-f-]{36}$/;

// One job's progress (RLS: the reader's own only), and Stop.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!req.headers.get(VERIFIED_USER_HEADER)) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const { id } = await params;
  if (!ID.test(id)) return NextResponse.json({ error: "job not found" }, { status: 404 });
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  // The generator on the VPS can't remove what it read (it has no storage
  // credential): the reader's own poll that sees the job end does.
  if (job.runner === "vps" && job.status !== "queued" && job.status !== "running") {
    after(() => endUploads(job));
  }
  return NextResponse.json({ job: publicJob(job) }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!req.headers.get(VERIFIED_USER_HEADER)) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const { id } = await params;
  if (!ID.test(id)) return NextResponse.json({ error: "job not found" }, { status: 404 });
  return NextResponse.json({ ok: await cancelJob(id) });
}
