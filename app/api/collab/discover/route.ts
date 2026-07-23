import { NextRequest, NextResponse } from "next/server";
import { searchFolders } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireUser } from "../route-helpers";

// Folder discovery. The discoverability rule lives in notes_search_folders,
// not here — a non-member never sees a folder whose owner turned discovery
// off, whatever this route is asked for.

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const params = req.nextUrl.searchParams;
    const tags = params.get("tags")?.split(",").map((t) => t.trim()).filter(Boolean);
    const folders = await searchFolders(
      params.get("q") ?? undefined,
      tags,
      Number(params.get("limit") ?? 20),
      Number(params.get("offset") ?? 0)
    );
    return NextResponse.json({ folders });
  } catch (err: any) {
    return errorResponse(err);
  }
}
