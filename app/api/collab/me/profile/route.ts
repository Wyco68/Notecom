import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { errorResponse, isResponse, requireUser } from "../../route-helpers";

// The caller's own profile row. Email lives on auth.users, not profiles, so it
// is read from the session and is display-only here — changing an email or a
// password goes through the existing auth flow (/auth/reset), which already
// handles the emailed-code second factor. Duplicating that here would create a
// second, weaker path to the same credential.

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;

  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("profiles")
      .select("username, avatar_url, created_at")
      .eq("id", user.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    return NextResponse.json({
      profile: {
        username: data?.username ?? null,
        avatarUrl: data?.avatar_url ?? null,
        createdAt: data?.created_at ?? null,
        email: auth.user?.email ?? null,
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
    const { username, avatarUrl } = await req.json();
    const patch: Record<string, unknown> = {};
    if (typeof username === "string" && username.trim()) patch.username = username.trim();
    if (typeof avatarUrl === "string") patch.avatar_url = avatarUrl.trim() || null;
    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }

    const supabase = await createClient();
    // RLS scopes profiles updates to the caller's own row; the id filter is
    // belt-and-braces so a policy change can never widen this handler.
    const { error } = await supabase.from("profiles").update(patch).eq("id", user.userId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}
