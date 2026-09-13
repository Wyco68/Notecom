import { NextRequest, NextResponse } from "next/server";
import { addFolderTag, listFolderTags, removeFolderTag } from "@/lib/collab/folders";
import {
  errorResponse,
  isResponse,
  MAX_SHORT_TEXT_LENGTH,
  readJSON,
  requireFolder,
  requireUser,
} from "../../../route-helpers";

// Folder topics. A topic is a label that helps people find a folder in
// Discover; it grants no access (0026). addFolderTag still writes the inert
// grants_join column as true only because the column survives.

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await requireUser(req);
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
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    const { slug } = await ctx.params;
    const body = await readJSON(req);
    if (isResponse(body)) return body;
    const { tag, owner } = body;
    if (!tag || typeof tag !== "string" || tag.length > MAX_SHORT_TEXT_LENGTH) {
      return NextResponse.json({ error: "tag required" }, { status: 400 });
    }
    const folder = await requireFolder(slug, owner);
    if (isResponse(folder)) return folder;

    await addFolderTag(folder.id, tag);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await requireUser(req);
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
