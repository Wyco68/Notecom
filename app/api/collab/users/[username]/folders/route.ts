import { NextRequest, NextResponse } from "next/server";
import { userFolders } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireUser } from "../../../route-helpers";

// One person's folders as the caller may see them — public ones, plus private
// ones the caller is a member of — featured first, a page at a time.

export async function GET(req: NextRequest, ctx: { params: Promise<{ username: string }> }) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    const { username } = await ctx.params;
    const params = req.nextUrl.searchParams;
    return NextResponse.json({
      folders: await userFolders(decodeURIComponent(username), {
        limit: Number(params.get("limit")) || undefined,
        offset: Number(params.get("offset")) || undefined,
      }),
    });
  } catch (err: any) {
    return errorResponse(err);
  }
}
