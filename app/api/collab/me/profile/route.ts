import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveAvatarUrl } from "@/lib/collab/avatar";
import { errorResponse, isResponse, requireUser } from "../../route-helpers";

// The caller's own profile row. Email lives on auth.users, not profiles, so it
// is read from the session and is display-only here — changing an email or a
// password goes through the existing auth flow (/auth/reset), which already
// handles the emailed-code second factor. Duplicating that here would create a
// second, weaker path to the same credential.
//
// The photo is not settable here either: it is a file, so it goes through
// /api/collab/me/avatar. This handler only reads it back, as a signed URL.

// Mirrors `v_cooldown` in
// supabase/migrations/0014_notes_profile_username_cooldown.sql. Used only to
// tell the user when their next rename is allowed — the trigger is what
// enforces the wait, so a stale copy here can mislabel a date but can never let
// an early rename through.
const USERNAME_COOLDOWN_DAYS = 15;

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("profiles")
      .select("username, avatar_url, created_at, username_updated_at")
      .eq("id", user.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    // Never renamed → changeable now (null). Otherwise the last rename plus the
    // cooldown, which the form compares against the current time.
    const changedAt = data?.username_updated_at ?? null;
    const changeableAt = changedAt
      ? new Date(
          new Date(changedAt).getTime() + USERNAME_COOLDOWN_DAYS * 86_400_000
        ).toISOString()
      : null;

    return NextResponse.json({
      profile: {
        username: data?.username ?? null,
        avatarUrl: await resolveAvatarUrl(supabase, data?.avatar_url),
        createdAt: data?.created_at ?? null,
        email: auth.user?.email ?? null,
        usernameChangeableAt: changeableAt,
        usernameCooldownDays: USERNAME_COOLDOWN_DAYS,
      },
    });
  } catch (err: any) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const { username } = await req.json();
    if (typeof username !== "string" || !username.trim()) {
      return NextResponse.json({ error: "username is required" }, { status: 400 });
    }

    const supabase = await createClient();
    // RLS scopes profiles updates to the caller's own row; the id filter is
    // belt-and-braces so a policy change can never widen this handler. Format
    // rules and the rename cooldown are the database's job — a trigger raises,
    // and errorResponse turns that into a status the form can show.
    const { error } = await supabase
      .from("profiles")
      .update({ username: username.trim() })
      .eq("id", user.userId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}
