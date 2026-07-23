import { NextRequest, NextResponse } from "next/server";
import { updateFolderSettings } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireFolder, requireUser } from "../../../route-helpers";

// Visibility, discoverability, join policy and description. The update policy
// on notes_folders is what restricts this to managers; an editor reaching this
// route gets a refusal from Postgres, not from an if-statement here.

const VISIBILITY = ["public", "private"];
const JOIN_POLICY = ["open", "request", "invite_only"];

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const { slug } = await ctx.params;
    const body = await req.json();
    const folder = await requireFolder(slug, body.owner);
    if (isResponse(folder)) return folder;

    if (body.visibility !== undefined && !VISIBILITY.includes(body.visibility)) {
      return NextResponse.json({ error: "invalid visibility" }, { status: 400 });
    }
    if (body.joinPolicy !== undefined && !JOIN_POLICY.includes(body.joinPolicy)) {
      return NextResponse.json({ error: "invalid join policy" }, { status: 400 });
    }

    await updateFolderSettings(folder.id, {
      visibility: body.visibility,
      discoverable: body.discoverable,
      joinPolicy: body.joinPolicy,
      description: body.description,
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}
