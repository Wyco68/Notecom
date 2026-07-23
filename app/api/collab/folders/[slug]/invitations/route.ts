import { NextRequest, NextResponse } from "next/server";
import { inviteMember, listFolderInvitations } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireFolder, requireUser } from "../../../route-helpers";

// Invitations issued for one folder. The invitee is named by username and
// resolved inside notes_invite_member, so this route never needs to read the
// profiles table — and the app never needs a policy that would let one user
// enumerate all the others.

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const { slug } = await ctx.params;
    const folder = await requireFolder(slug, req.nextUrl.searchParams.get("owner") ?? undefined);
    if (isResponse(folder)) return folder;
    return NextResponse.json({ invitations: await listFolderInvitations(folder.id) });
  } catch (err: any) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const { slug } = await ctx.params;
    const { username, role, owner } = await req.json();
    if (!username || typeof username !== "string") {
      return NextResponse.json({ error: "username required" }, { status: 400 });
    }
    const folder = await requireFolder(slug, owner);
    if (isResponse(folder)) return folder;

    await inviteMember(folder.id, username, role === "editor" ? "editor" : "viewer");
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}
