import { NextRequest, NextResponse } from "next/server";
import { related } from "@/lib/search/indexd";
import { isRemoteVault } from "@/lib/vault/helper";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ folder: string; id: string }> }
) {
  const { folder, id } = await params;
  const kind = req.nextUrl.searchParams.get("kind") ?? "lesson";
  // "Related" is an indexd (vector-similarity) feature; the remote
  // deployments have no indexd, so return an empty set rather than 502.
  if (isRemoteVault()) {
    return NextResponse.json({ results: [] });
  }
  try {
    const data = await related(folder, id, kind);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
