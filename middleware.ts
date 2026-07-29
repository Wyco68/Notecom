import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Single choke point for one rule: notes are for signed-in people. Every page
// and API route matched below needs a Supabase session; without one a page
// redirects to sign-in and an API answers 401. `/api/auth/*` is exempt, since
// that is how a session is obtained. On an install with no Supabase configured
// there are no accounts to demand, so the gate stands down and the app stays
// purely local.
//
// There is no read-only mode any more. Every instance is writable by whoever
// runs it: generation spawns *that person's* Claude Code CLI on *their own*
// subscription (lib/generate/runner.ts), so there is no shared resource for a
// server-wide flag to protect. What an instance can actually do is decided by
// what it has — a box with no `stored` sidecar and no vault on disk fails a
// write because the write has nowhere to go, not because a flag forbade it.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function signedIn(req: NextRequest): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return true;
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      // Middleware only reads the session here; refreshing it is the job of the
      // route handlers that own a response.
      setAll: () => {},
    },
  });
  const { data } = await supabase.auth.getUser();
  return !!data.user;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (!path.startsWith("/api/auth") && !(await signedIn(req))) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "sign in required" }, { status: 401 });
    }
    const to = new URL("/auth/sign-in", req.url);
    to.searchParams.set("next", path + req.nextUrl.search);
    return NextResponse.redirect(to);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/vault/:path*", "/discover", "/account"],
};
