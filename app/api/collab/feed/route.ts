import { NextRequest, NextResponse } from "next/server";
import { feed } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireUser } from "../route-helpers";

// The home feed, a page at a time (`?before=<iso>&limit`). What it may contain
// is decided by notes_feed: documents in folders the caller belongs to, and
// public folders from people they follow — nothing they couldn't already read.

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    const params = req.nextUrl.searchParams;
    const before = params.get("before");
    if (before && Number.isNaN(Date.parse(before))) {
      return NextResponse.json({ error: "before must be an ISO timestamp" }, { status: 400 });
    }
    return NextResponse.json({
      items: await feed({
        before: before ?? undefined,
        limit: Number(params.get("limit")) || undefined,
      }),
    });
  } catch (err: any) {
    return errorResponse(err);
  }
}
