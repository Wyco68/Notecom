import { NextRequest, NextResponse } from "next/server";
import { related } from "@/lib/search/indexd";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ folder: string; id: string }> }
) {
  const { folder, id } = await params;
  const kind = req.nextUrl.searchParams.get("kind") ?? "lesson";
  try {
    const data = await related(folder, id, kind);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
