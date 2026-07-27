import { NextRequest, NextResponse } from "next/server";
import { requestJoin } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireFolder, requireUser } from "../route-helpers";

// Joining a folder. Which path applies is the folder's decision, made inside
// the RPC: notes_request_join joins outright when join_policy is 'open', files
// a request when it is 'request', and refuses when it is 'invite_only'.
//
// There is deliberately no tag path any more. A tag is not something you join
// through — holding one grants access to folders carrying it directly, and the
// tag itself arrives as an offer you accept (see /api/collab/me/grants).

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const { slug, owner, message } = await req.json();
    if (!slug || typeof slug !== "string") {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const folder = await requireFolder(slug, owner);
    if (isResponse(folder)) return folder;

    return NextResponse.json({ status: await requestJoin(folder.id, message) });
  } catch (err: any) {
    return errorResponse(err);
  }
}
