import { NextRequest, NextResponse } from "next/server";
import { updateFolderSettings } from "@/lib/collab/folders";
import {
  errorResponse,
  isResponse,
  readJSON,
  requireFolder,
  requireUser,
} from "../../../route-helpers";

// Visibility and description — the whole of a folder's settings now. The
// update policy on notes_folders is what restricts this to managers; an editor
// reaching this route gets a refusal from Postgres, not from an if-statement
// here.
//
// Discoverability and join policy are deliberately not accepted any more:
// "public" already means listed, and the only way in is a request the owner
// approves.

const VISIBILITY = ["public", "private"];
// Matches notes_folders_description_check (supabase/migrations/0001) — caught
// here so an over-long description comes back as a clean 400 instead of a
// raw check-constraint failure with no status this route's error map covers.
const MAX_DESCRIPTION_LENGTH = 2000;

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    const { slug } = await ctx.params;
    const body = await readJSON(req);
    if (isResponse(body)) return body;
    const folder = await requireFolder(slug, body.owner);
    if (isResponse(folder)) return folder;

    if (body.visibility !== undefined && !VISIBILITY.includes(body.visibility)) {
      return NextResponse.json({ error: "invalid visibility" }, { status: 400 });
    }
    if (
      body.description !== undefined &&
      body.description !== null &&
      (typeof body.description !== "string" || body.description.length > MAX_DESCRIPTION_LENGTH)
    ) {
      return NextResponse.json(
        { error: `description must be a string of at most ${MAX_DESCRIPTION_LENGTH} characters` },
        { status: 400 }
      );
    }
    await updateFolderSettings(folder.id, {
      visibility: body.visibility,
      description: body.description,
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}
