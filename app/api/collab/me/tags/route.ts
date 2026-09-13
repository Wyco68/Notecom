import { NextRequest, NextResponse } from "next/server";
import { myCreatedTags } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireUser } from "../../route-helpers";

// Topics the caller has authored in notes_tags' shared vocabulary. Tags are
// labels now, not access (0026), so there is nothing held to list or drop.

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    return NextResponse.json({ created: await myCreatedTags() });
  } catch (err: any) {
    return errorResponse(err);
  }
}
