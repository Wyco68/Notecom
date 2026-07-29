import { NextRequest, NextResponse } from "next/server";
import { leaveFolder, listMembers, removeMember, setMemberRole } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireFolder, requireUser } from "../../../route-helpers";

// Member list, role changes and removal. DELETE covers both "owner removes a
// member" and "member leaves": which one it is depends on whether the target
// is the caller, and each path has its own guard in the database.

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const { slug } = await ctx.params;
    const params = req.nextUrl.searchParams;
    const folder = await requireFolder(slug, params.get("owner") ?? undefined);
    if (isResponse(folder)) return folder;

    // Paged: the list is unbounded, and the console shows a page at a time.
    return NextResponse.json(
      await listMembers(folder.id, {
        q: params.get("q") ?? undefined,
        limit: Number(params.get("limit")) || undefined,
        offset: Number(params.get("offset")) || undefined,
      })
    );
  } catch (err: any) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const { slug } = await ctx.params;
    const { userId, role, owner } = await req.json();
    if (!userId || !role) {
      return NextResponse.json({ error: "userId and role required" }, { status: 400 });
    }
    const folder = await requireFolder(slug, owner);
    if (isResponse(folder)) return folder;

    await setMemberRole(folder.id, userId, role);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const { slug } = await ctx.params;
    const folder = await requireFolder(slug, req.nextUrl.searchParams.get("owner") ?? undefined);
    if (isResponse(folder)) return folder;

    const target = req.nextUrl.searchParams.get("userId");
    if (!target || target === user.userId) {
      await leaveFolder(folder.id);
    } else {
      await removeMember(folder.id, target);
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}
