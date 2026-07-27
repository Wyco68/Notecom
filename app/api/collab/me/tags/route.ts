import { NextRequest, NextResponse } from "next/server";
import { myTags, removeMyTag } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireUser } from "../../route-helpers";

// The caller's own tags. There is no POST: a tag cannot be self-assigned, only
// received from someone you follow and then accepted (/api/collab/me/grants).
// That is what makes a tag worth something as an access grant — otherwise
// anyone could self-assign the tag that opens a folder.
//
// DELETE stays, because dropping a tag is always the holder's right, and it
// revokes every folder that tag was granting in one step.

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    return NextResponse.json({ tags: await myTags() });
  } catch (err: any) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
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
