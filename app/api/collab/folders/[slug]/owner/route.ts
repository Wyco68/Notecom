import { NextRequest, NextResponse } from "next/server";
import { transferOwnership } from "@/lib/collab/folders";
import {
  errorResponse,
  isResponse,
  readJSON,
  requireFolder,
  requireUser,
} from "../../../route-helpers";

// Ownership transfer. Owners are never demoted by anyone else, so this is the
// only way the owner role moves. The RPC re-checks that the caller is the
// current owner and that the target is already a member — this handler adds no
// authorization of its own, same as every other collab route.

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    const { slug } = await ctx.params;
    const body = await readJSON(req);
    if (isResponse(body)) return body;
    const { userId, owner } = body;
    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    const folder = await requireFolder(slug, owner);
    if (isResponse(folder)) return folder;

    return NextResponse.json({ status: await transferOwnership(folder.id, userId) });
  } catch (err: any) {
    return errorResponse(err);
  }
}
