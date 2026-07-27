import { NextRequest, NextResponse } from "next/server";
import { searchFolders } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireUser } from "../route-helpers";

// Folder discovery. The discoverability rule lives in notes_search_folders,
// not here — a non-member never sees a folder whose owner turned discovery
// off, whatever this route is asked for.
//
// Searching by tag is gone on purpose: a tag now grants read access to the
// folders carrying it, so letting anyone ask "which folders does this tag
// open" would publish the list of folders worth acquiring it for.

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const params = req.nextUrl.searchParams;
    const folders = await searchFolders(
      params.get("q") ?? undefined,
      Number(params.get("limit") ?? 20),
      Number(params.get("offset") ?? 0)
    );
    return NextResponse.json({ folders });
  } catch (err: any) {
    return errorResponse(err);
  }
}
