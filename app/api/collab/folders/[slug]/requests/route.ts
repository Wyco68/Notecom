import { NextRequest, NextResponse } from "next/server";
import { listJoinRequests, respondJoinRequest } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireFolder, requireUser } from "../../../route-helpers";

// Pending join requests for one folder, and the owner's decision on them.
// Both directions are manager-only, enforced by the select policy and by
// notes_respond_join_request respectively.

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const { slug } = await ctx.params;
    const folder = await requireFolder(slug, req.nextUrl.searchParams.get("owner") ?? undefined);
    if (isResponse(folder)) return folder;
    return NextResponse.json({ requests: await listJoinRequests(folder.id) });
  } catch (err: any) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    await ctx.params;
    const { requestId, approve } = await req.json();
    if (!requestId || typeof requestId !== "string") {
      return NextResponse.json({ error: "requestId required" }, { status: 400 });
    }
    await respondJoinRequest(requestId, !!approve);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}
