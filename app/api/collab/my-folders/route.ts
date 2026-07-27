import { NextResponse } from "next/server";
import { myFolders } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireUser } from "../route-helpers";

// The caller's folders with their collaboration metadata — tags, role, member
// and document counts. The sidebar merges this onto the local tree from
// /api/tree (which comes from stored/SQLite and knows nothing about tags) to
// group folders by tag. Kept separate rather than teaching stored about tags:
// collaboration state belongs to Supabase, not to the local datastore.

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    return NextResponse.json({ folders: await myFolders() });
  } catch (err: any) {
    return errorResponse(err);
  }
}
