import { NextRequest, NextResponse } from "next/server";
import { myFolders } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireUser } from "../route-helpers";

// The caller's folders with their collaboration metadata — tags, role, member
// and document counts. The sidebar merges this onto the tree from /api/tree
// (which knows nothing about tags) to group folders by tag. Kept as a
// separate query rather than folded into the tree route, since it's
// collaboration-specific and most tree reads don't need it.

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    return NextResponse.json({ folders: await myFolders() });
  } catch (err: any) {
    return errorResponse(err);
  }
}
