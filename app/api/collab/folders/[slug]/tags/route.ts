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

// Folder tags. Every tag placed on a folder grants joining now — anyone who
// holds it gets tag-implied viewer access to the folder, with no join step
// and no approval. grants_join survives as a column (see the
// notes_tag_implied_folder_access migration) but the app no longer offers a
// way to set it false, so addFolderTag always writes true.

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
