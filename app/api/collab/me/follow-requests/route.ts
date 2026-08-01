import { NextRequest, NextResponse } from "next/server";
import { myFollowRequests, respondFollow } from "@/lib/collab/folders";
import { errorResponse, isResponse, readJSON, requireUser } from "../../route-helpers";

// The caller's inbox of incoming follow requests, and the answer to one.
// GET lists who has asked to follow the caller and is still waiting; POST
// answers a specific request. The RPC re-checks that the row is really
// pending and really addressed to the caller — nothing here does.

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    return NextResponse.json({ requests: await myFollowRequests() });
  } catch (err: any) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    const body = await readJSON(req);
    if (isResponse(body)) return body;
    const { followerId, accept } = body;
    if (!followerId || typeof followerId !== "string") {
      return NextResponse.json({ error: "followerId required" }, { status: 400 });
    }
    await respondFollow(followerId, !!accept);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}
