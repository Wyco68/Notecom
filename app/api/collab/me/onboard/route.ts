import { NextRequest, NextResponse } from "next/server";
import { onboard } from "@/lib/collab/folders";
import { errorResponse, isResponse, requireUser } from "../../route-helpers";

// Put a new account into the featured folders. Safe to call on every visit:
// the RPC runs once per account and answers 0 afterwards, so the client needs
// no "have I onboarded" state of its own. `joined` is what tells it whether
// there is anything new to show.

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    return NextResponse.json({ joined: await onboard() });
  } catch (err: any) {
    return errorResponse(err);
  }
}
