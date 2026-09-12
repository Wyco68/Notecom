import { NextRequest, NextResponse } from "next/server";
import { STARTER_TAG_SLUG, claimTag, follow, starterTag } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireUser } from "../../route-helpers";

// The starter offer a brand-new account sees: one published tag it may claim
// for itself, and the account that published it.
//
// This is the only self-assignable tag in the app, and the database is what
// says so — `notes_claim_tag()` refuses any tag not marked `self_serve`
// (0025). Nothing here decides it, so a client calling POST with a different
// tag in mind has nothing to gain: the slug is not even a parameter.
//
// GET answers "should the banner show", not "is the tag claimable": a caller
// who already holds it, or who owns folders of their own, is not a new account
// and gets the same shape with the flags set. The banner reads them; a
// returned `null` tag means this database has no starter tag at all.

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    return NextResponse.json({ tag: await starterTag() });
  } catch (err: any) {
    return errorResponse(err);
  }
}

/**
 * Claim the starter tag, and follow the account that published it.
 *
 * Both in one call because they are one intent — "set me up with the demo" —
 * and because they answer different needs: the tag is what makes the folders
 * readable now, while the follow is what lets that account offer a real tag or
 * a folder invitation later. Following starts `pending` like any other follow
 * request, so it grants nothing until the owner accepts; the tag does not wait
 * on it.
 *
 * The follow is best-effort on purpose. A failure there (already following,
 * the owner's profile gone) must not cost the caller the tag, which is the
 * part that actually puts notes on their screen.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    const label = await claimTag(STARTER_TAG_SLUG);

    const tag = await starterTag().catch(() => null);
    let followed = false;
    if (tag?.owner) {
      followed = await follow(tag.owner).then(
        () => true,
        () => false
      );
    }

    return NextResponse.json({ label, owner: tag?.owner ?? null, followed });
  } catch (err: any) {
    return errorResponse(err);
  }
}
