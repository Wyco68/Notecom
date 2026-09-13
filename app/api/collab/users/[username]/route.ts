import { NextRequest, NextResponse } from "next/server";
import { profile } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireUser } from "../../route-helpers";

// One person's profile header: avatar, accepted follow counts, public folder
// count, and the caller's own follow state toward them.

export async function GET(req: NextRequest, ctx: { params: Promise<{ username: string }> }) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    const { username } = await ctx.params;
    const found = await profile(decodeURIComponent(username));
    if (!found) return NextResponse.json({ error: "no such user" }, { status: 404 });
    return NextResponse.json({ profile: found });
  } catch (err: any) {
    return errorResponse(err);
  }
}
