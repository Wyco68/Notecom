import { NextRequest, NextResponse } from "next/server";
import { myCreatedTags, myTags, removeMyTag } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireUser } from "../../route-helpers";

// The caller's own tags. There is no POST: a tag cannot be self-assigned, only
// received from someone you follow and then accepted (/api/collab/me/grants).
// That is what makes a tag worth something as an access grant — otherwise
// anyone could self-assign the tag that opens a folder.
//
// DELETE stays, because dropping a tag is always the holder's right, and it
// revokes every folder that tag was granting in one step.
//
// GET also returns `created`: tags the caller has authored in notes_tags'
// shared vocabulary, separate from `tags` (tags the caller holds). This is
// what backs "pick from tags you've already created" when adding a tag to a
// folder — bundled onto this route rather than a new one because it is
// already the caller-scoped tag endpoint.

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    const [tags, created] = await Promise.all([myTags(), myCreatedTags()]);
    return NextResponse.json({ tags, created });
  } catch (err: any) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    const tag = req.nextUrl.searchParams.get("tag");
    if (!tag) return NextResponse.json({ error: "tag required" }, { status: 400 });
    await removeMyTag(tag);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}
