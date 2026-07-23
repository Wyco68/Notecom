import { NextRequest, NextResponse } from "next/server";
import { collabEnabled, createClient } from "@/lib/supabase/server";

// OAuth / magic-link landing. Supabase hands back a one-time code here; this
// exchanges it for a session cookie and sends the user on. The code is
// single-use and never stored by the app.

export async function GET(req: NextRequest) {
  if (!collabEnabled()) {
    return NextResponse.redirect(new URL("/vault", req.url));
  }
  const code = req.nextUrl.searchParams.get("code");
  const next = req.nextUrl.searchParams.get("next") ?? "/vault";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL(`/auth/sign-in?error=${encodeURIComponent(error.message)}`, req.url)
      );
    }
  }
  // Relative only: an absolute `next` would make this an open redirect.
  return NextResponse.redirect(new URL(next.startsWith("/") ? next : "/vault", req.url));
}
