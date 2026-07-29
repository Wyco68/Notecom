import { NextRequest, NextResponse } from "next/server";
import { follow, listFollows, unfollow } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireUser } from "../../route-helpers";

// Following is one-sided and needs no approval from the other person. Its only
// power is permissive in one direction: following someone lets *them* offer
// you a tag or invite you to a folder. So the follower is always the one who
// opens the door, and either side can close it again (DELETE).

// One direction, one page at a time (`?direction=following|followers&q&limit
// &offset`). Nobody needs every edge at once, and the caller that wants both
// sides asks twice.
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const params = req.nextUrl.searchParams;
    const direction = params.get("direction") === "followers" ? "followers" : "following";
    return NextResponse.json({
      direction,
      ...(await listFollows(direction, {
        q: params.get("q") ?? undefined,
        limit: Number(params.get("limit")) || undefined,
        offset: Number(params.get("offset")) || undefined,
      })),
    });
  } catch (err: any) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const { username } = await req.json();
    if (!username || typeof username !== "string") {
      return NextResponse.json({ error: "username required" }, { status: 400 });
    }
    await follow(username);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const userId = req.nextUrl.searchParams.get("userId");
    const direction = req.nextUrl.searchParams.get("direction");
    if (!userId || (direction !== "following" && direction !== "followers")) {
      return NextResponse.json(
        { error: "userId and direction (following|followers) required" },
        { status: 400 }
      );
    }
    await unfollow(userId, direction);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}
