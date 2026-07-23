import { NextRequest, NextResponse } from "next/server";
import { joinByTag, requestJoin } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireFolder, requireUser } from "../route-helpers";

// Joining a folder. Which of the two paths applies is the folder's decision,
// made inside the RPC: notes_request_join joins outright when join_policy is
// 'open', files a request when it is 'request', and refuses when it is
// 'invite_only'. The response says which happened.

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const { slug, owner, via, tag, message } = await req.json();
    if (!slug || typeof slug !== "string") {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const folder = await requireFolder(slug, owner);
    if (isResponse(folder)) return folder;

    if (via === "tag") {
      if (!tag || typeof tag !== "string") {
        return NextResponse.json({ error: "tag required" }, { status: 400 });
      }
      return NextResponse.json({ status: await joinByTag(folder.id, tag) });
    }
    return NextResponse.json({ status: await requestJoin(folder.id, message) });
  } catch (err: any) {
    return errorResponse(err);
  }
}
