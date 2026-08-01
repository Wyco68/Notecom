import { NextRequest, NextResponse } from "next/server";
import { requestJoin } from "@/lib/collab/folders";
import {
  errorResponse,
  isResponse,
  MAX_SHORT_TEXT_LENGTH,
  readJSON,
  requireFolder,
  requireUser,
} from "../route-helpers";

// A join request's message shares the same reasonable ceiling as any other
// short free-text field the caller controls; the RPC doesn't itself cap it.
const MAX_MESSAGE_LENGTH = MAX_SHORT_TEXT_LENGTH;

// Joining a folder. Which path applies is the folder's decision, made inside
// the RPC: notes_request_join joins outright when join_policy is 'open', files
// a request when it is 'request', and refuses when it is 'invite_only'.
//
// There is deliberately no tag path any more. A tag is not something you join
// through — holding one grants access to folders carrying it directly, and the
// tag itself arrives as an offer you accept (see /api/collab/me/grants).

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    const body = await readJSON(req);
    if (isResponse(body)) return body;
    const { slug, owner, message } = body;
    if (!slug || typeof slug !== "string") {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    if (
      message !== undefined &&
      message !== null &&
      (typeof message !== "string" || message.length > MAX_MESSAGE_LENGTH)
    ) {
      return NextResponse.json(
        { error: `message must be a string of at most ${MAX_MESSAGE_LENGTH} characters` },
        { status: 400 }
      );
    }
    const folder = await requireFolder(slug, owner);
    if (isResponse(folder)) return folder;

    return NextResponse.json({ status: await requestJoin(folder.id, message) });
  } catch (err: any) {
    return errorResponse(err);
  }
}
