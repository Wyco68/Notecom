import { NextRequest, NextResponse } from "next/server";
import { inviteMember, listFolderInvitations } from "@/lib/collab/folders";
import {
  errorResponse,
  isResponse,
  MAX_SHORT_TEXT_LENGTH,
  readJSON,
  requireFolder,
  requireUser,
} from "../../../route-helpers";

// Invitations issued for one folder. The invitee is named by username and
// resolved inside notes_invite_member, so this route never needs to read the
// profiles table — and the app never needs a policy that would let one user
// enumerate all the others.

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await requireUser(req);
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
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    const { slug } = await ctx.params;
    const body = await readJSON(req);
    if (isResponse(body)) return body;
    const { username, role, owner } = body;
    if (!username || typeof username !== "string" || username.length > MAX_SHORT_TEXT_LENGTH) {
      return NextResponse.json({ error: "username required" }, { status: 400 });
    }
    if (role !== undefined && role !== "editor" && role !== "viewer") {
      return NextResponse.json({ error: "role must be editor or viewer" }, { status: 400 });
    }
    const folder = await requireFolder(slug, owner);
    if (isResponse(folder)) return folder;

    await inviteMember(folder.id, username, role === "editor" ? "editor" : "viewer");
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}
