// Shared plumbing for the /api/collab/* handlers.
//
// These routes hold no authorization logic — the database refuses what the
// caller may not do, and this turns that refusal into the app's usual
// { error } shape. The only check here is "is anyone signed in", which is
// about giving a 401 instead of a confusing empty result.

import { NextRequest, NextResponse } from "next/server";
import { collabEnabled } from "@/lib/supabase/server";
import { getFolder } from "@/lib/collab/folders";
import type { FolderDetail } from "@/lib/collab/types";
import { VERIFIED_USER_HEADER } from "@/middleware";

export function collabDisabled() {
  return NextResponse.json(
    { error: "collaboration is not configured on this server" },
    { status: 501 }
  );
}

/**
 * A generous ceiling for one free-text body field (a username, a tag label)
 * before it reaches Supabase. Not a business rule — the database's own
 * constraints and triggers (e.g. is_valid_username, the 40-char tag label
 * check) are that, and stay the real limit — this just stops a client handing
 * a handler an enormous string to parse and forward for no legitimate reason.
 */
export const MAX_SHORT_TEXT_LENGTH = 200;

/**
 * Parse the request body as JSON, or a 400 to return as-is. A malformed body
 * is a client mistake, not a server error: without this it falls into the
 * same catch block as a refused RPC and comes back 500 via errorResponse
 * instead of a clean 400.
 */
export async function readJSON(req: NextRequest): Promise<any> {
  try {
    return await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
}

/**
 * The signed-in user's id, or a 401 response to return as-is.
 *
 * Every route this guards sits behind middleware.ts's matcher, which has
 * already called supabase.auth.getUser() once for this request and refused
 * anything unauthenticated — calling it again here would be a second Supabase
 * Auth round trip to reconfirm what middleware already knows. Trust its
 * verified header instead; middleware always overwrites it, so nothing a
 * client sends can reach here as this header. A request that somehow arrives
 * without it (matcher misconfigured, direct invocation in a test) is treated
 * as unauthenticated rather than re-checked — fail closed, not fail open.
 */
export async function requireUser(req: NextRequest): Promise<{ userId: string } | NextResponse> {
  if (!collabEnabled()) return collabDisabled();
  const userId = req.headers.get(VERIFIED_USER_HEADER);
  if (!userId) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  return { userId };
}

/**
 * Resolve a folder the caller can see, or a 404. A folder RLS hides is
 * indistinguishable from one that does not exist — deliberately, so a probe
 * can't enumerate private folders.
 */
export async function requireFolder(
  slug: string,
  owner?: string
): Promise<FolderDetail | NextResponse> {
  const folder = await getFolder(decodeURIComponent(slug), owner);
  if (!folder) return NextResponse.json({ error: "folder not found" }, { status: 404 });
  return folder;
}

export function isResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}

/**
 * Map a thrown error to a status. The RPCs raise SQLSTATE 42501 for "not
 * allowed" and P0002 for "no such row" — lib/collab/folders.ts's rpc()
 * wrapper preserves that code, so it is checked first; the message regex is
 * a fallback for errors that arrive without one (e.g. a plain select).
 */
export function errorResponse(err: any): NextResponse {
  const message = String(err?.message ?? err ?? "unexpected error");
  const code = err?.code as string | undefined;
  const status =
    code === "42501"
      ? 403
      : code === "P0002"
        ? 404
        : code === "23505" || code === "22023"
          ? 400
          : /not authorized|invite only|cannot |does not grant|permission denied/i.test(message)
            ? 403
            : /no such|not found|no pending/i.test(message)
              ? 404
              : /already|invalid|too short|is required|only be changed/i.test(message)
                ? 400
                : 500;
  return NextResponse.json({ error: message }, { status });
}
