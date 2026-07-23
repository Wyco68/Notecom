import { NextRequest, NextResponse } from "next/server";
import { listFolderTags, listMembers } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireFolder, requireUser } from "../../route-helpers";

// One folder, with whatever of its members and tags RLS lets the caller see.
// A non-member of a discoverable folder gets the metadata and an empty member
// list rather than a 403 — that is what makes a useful discovery card.

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const { slug } = await ctx.params;
    const folder = await requireFolder(slug, req.nextUrl.searchParams.get("owner") ?? undefined);
    if (isResponse(folder)) return folder;

    const [members, tags] = await Promise.all([
      listMembers(folder.id).catch(() => []),
      listFolderTags(folder.id).catch(() => []),
    ]);
    return NextResponse.json({ folder, role: folder.myRole, members, tags });
  } catch (err: any) {
    return errorResponse(err);
  }
}
