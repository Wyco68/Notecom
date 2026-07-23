import { NextRequest, NextResponse } from "next/server";
import { addFolderTag, listFolderTags, removeFolderTag } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireFolder, requireUser } from "../../../route-helpers";

// Folder tags. grantsJoin is the per-tag access grant: with it set, anyone who
// found the folder through that tag may join without approval. It is a
// property of the folder-tag edge, not of the tag, so the same tag can open
// one folder and merely describe another.

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const { slug } = await ctx.params;
    const folder = await requireFolder(slug, req.nextUrl.searchParams.get("owner") ?? undefined);
    if (isResponse(folder)) return folder;
    return NextResponse.json({ tags: await listFolderTags(folder.id) });
  } catch (err: any) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const { slug } = await ctx.params;
    const { tag, grantsJoin, owner } = await req.json();
    if (!tag || typeof tag !== "string") {
      return NextResponse.json({ error: "tag required" }, { status: 400 });
    }
    const folder = await requireFolder(slug, owner);
    if (isResponse(folder)) return folder;

    await addFolderTag(folder.id, tag, !!grantsJoin);
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

    const tag = req.nextUrl.searchParams.get("tag");
    if (!tag) return NextResponse.json({ error: "tag required" }, { status: 400 });

    await removeFolderTag(folder.id, tag);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}
