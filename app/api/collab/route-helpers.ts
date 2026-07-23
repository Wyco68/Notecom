// Shared plumbing for the /api/collab/* handlers.
//
// These routes hold no authorization logic — the database refuses what the
// caller may not do, and this turns that refusal into the app's usual
// { error } shape. The only check here is "is anyone signed in", which is
// about giving a 401 instead of a confusing empty result.

import { NextResponse } from "next/server";
import { collabEnabled, createClient } from "@/lib/supabase/server";
import { getFolder } from "@/lib/collab/folders";
import type { FolderDetail } from "@/lib/collab/types";

export function collabDisabled() {
  return NextResponse.json(
    { error: "collaboration is not configured on this server" },
    { status: 501 }
  );
}

/** The signed-in user's id, or a 401 response to return as-is. */
export async function requireUser(): Promise<{ userId: string } | NextResponse> {
  if (!collabEnabled()) return collabDisabled();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  return { userId: data.user.id };
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
 * allowed" and P0002 for "no such row"; supabase-js surfaces those as text, so
 * the message is what there is to match on.
 */
export function errorResponse(err: any): NextResponse {
  const message = String(err?.message ?? err ?? "unexpected error");
  const status = /not authorized|invite only|cannot |does not grant|permission denied/i.test(message)
    ? 403
    : /no such|not found|no pending/i.test(message)
      ? 404
      : /already|invalid|too short/i.test(message)
        ? 400
        : 500;
  return NextResponse.json({ error: message }, { status });
}
