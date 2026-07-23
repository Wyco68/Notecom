import { NextRequest, NextResponse } from "next/server";
import { myInvitations, respondInvitation } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireUser } from "../route-helpers";

// The caller's own invitation inbox. Scoping is by RLS: the select policy on
// notes_folder_invitations only exposes rows where the caller is the invitee,
// the inviter, or a manager of the folder.

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    return NextResponse.json({ invitations: await myInvitations() });
  } catch (err: any) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const { invitationId, accept } = await req.json();
    if (!invitationId || typeof invitationId !== "string") {
      return NextResponse.json({ error: "invitationId required" }, { status: 400 });
    }
    await respondInvitation(invitationId, !!accept);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}
