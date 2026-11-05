import { NextRequest, NextResponse } from "next/server";
import { VERIFIED_USER_HEADER } from "@/middleware";
import { runJob } from "@/lib/jobs/run";

export const maxDuration = 300;

const ID = /^[0-9a-f-]{36}$/;

// Continues a job: the page calls this while a job of the reader's is still
// going and no worker holds it (it paused at a time limit, or its worker
// died). Answers when the job ends or this request's time is nearly up.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!req.headers.get(VERIFIED_USER_HEADER)) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const { id } = await params;
  if (!ID.test(id)) return NextResponse.json({ error: "job not found" }, { status: 404 });
  const outcome = await runJob(id, Date.now() + (maxDuration - 20) * 1000);
  return NextResponse.json({ outcome });
}
