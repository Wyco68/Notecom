import { NextRequest, NextResponse } from "next/server";
import { related } from "@/lib/search/search";

// Mirrors lib/vault/store.ts's Kind union — the only two document kinds the
// vault knows about.
const KINDS = ["lesson", "quiz"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ folder: string; id: string }> }
) {
  const { folder, id } = await params;
  const kind = req.nextUrl.searchParams.get("kind") ?? "lesson";
  if (!KINDS.includes(kind)) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }
  try {
    const data = await related(folder, id, kind);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
