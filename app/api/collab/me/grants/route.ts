import { NextRequest, NextResponse } from "next/server";
import {
  grantTag,
  grantedTags,
  myTagGrants,
  respondTagGrant,
  revokeTag,
} from "@/lib/collab/folders";
import {
  errorResponse,
  isResponse,
  MAX_SHORT_TEXT_LENGTH,
  readJSON,
  requireUser,
} from "../../route-helpers";

// Tag offers. GET returns both directions — the caller's inbox and what they
// have handed out. POST is either "offer a tag to a follower" (username + tag)
// or "answer an offer made to me" (grantId + accept). DELETE takes a tag back,
// which closes every folder it was opening for that person.
//
// Every branch is refused by the RPC unless the follow edge exists and the
// caller is the right party — no check lives here.

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    const [grants, given] = await Promise.all([myTagGrants(), grantedTags()]);
    return NextResponse.json({ grants, given });
  } catch (err: any) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    const body = await readJSON(req);
    if (isResponse(body)) return body;
    const { username, tag, grantId, accept } = body;

    if (grantId) {
      if (typeof grantId !== "string") {
        return NextResponse.json({ error: "grantId must be a string" }, { status: 400 });
      }
      return NextResponse.json({ status: await respondTagGrant(grantId, !!accept) });
    }
    if (
      !username ||
      typeof username !== "string" ||
      username.length > MAX_SHORT_TEXT_LENGTH ||
      !tag ||
      typeof tag !== "string" ||
      tag.length > MAX_SHORT_TEXT_LENGTH
    ) {
      return NextResponse.json(
        { error: "username and tag required, or grantId and accept" },
        { status: 400 }
      );
    }
    return NextResponse.json({ id: await grantTag(username, tag) });
  } catch (err: any) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    const username = req.nextUrl.searchParams.get("username");
    const tag = req.nextUrl.searchParams.get("tag");
    if (!username || !tag) {
      return NextResponse.json({ error: "username and tag required" }, { status: 400 });
    }
    return NextResponse.json({ status: await revokeTag(username, tag) });
  } catch (err: any) {
    return errorResponse(err);
  }
}
