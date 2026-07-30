import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/search/search";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "missing q" }, { status: 400 });
  }
  const folder = req.nextUrl.searchParams.get("folder") ?? undefined;
  const kind = req.nextUrl.searchParams.get("kind") ?? undefined;
  const limit = Number(req.nextUrl.searchParams.get("limit")) || undefined;
  try {
    const data = await search({ q, folder, kind, limit });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
