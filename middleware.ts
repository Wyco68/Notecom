import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Single choke point for two rules.
//
// 1. Notes are for signed-in people. Every page and API route matched below
//    needs a Supabase session; without one a page redirects to sign-in and an
//    API answers 401. `/api/auth/*` is exempt, since that is how a session is
//    obtained. On an install with no Supabase configured there are no accounts
//    to demand, so the gate stands down and the app stays purely local.
// 2. READ_ONLY=1 blocks every vault-mutating request, so gating doesn't have to
//    be repeated per route file. Three exceptions:
//      - /api/chat: a read-only box may still run Ollama.
//      - /api/collab: these write membership, not note content.
//      - /api/auth/collab: signing in writes a session, not a note.
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
  const isApi = path.startsWith("/api/");

  if (!path.startsWith("/api/auth") && !(await signedIn(req))) {
    if (isApi) return NextResponse.json({ error: "sign in required" }, { status: 401 });
    const to = new URL("/auth/sign-in", req.url);
    to.searchParams.set("next", path + req.nextUrl.search);
    return NextResponse.redirect(to);
  }

  if (process.env.READ_ONLY !== "1" || !isApi) return NextResponse.next();
  if (req.method === "GET" || req.method === "HEAD") return NextResponse.next();
  if (
    path === "/api/chat" ||
    path === "/api/auth/collab" ||
    path.startsWith("/api/collab/")
  ) {
    return NextResponse.next();
  }
  return NextResponse.json({ error: "read-only server" }, { status: 403 });
}

export const config = {
  matcher: ["/api/:path*", "/vault/:path*", "/discover", "/account"],
};
