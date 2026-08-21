import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Single choke point for one rule: notes are for signed-in people. Every page
// and API route matched below needs a Supabase session; without one a page
// redirects to sign-in and an API answers 401. `/api/auth/collab` is the one
// exception — sign-up/sign-in/reset, which is how a session is obtained in
// the first place. `/api/auth` and `/api/auth/stream` are a different thing
// entirely (the local Claude Code CLI's own login, lib/auth/cli.ts) and are
// gated like everything else: nothing about starting, cancelling or reading
// that flow needs to be reachable by someone with no Notecom account at all,
// and every real caller (components/modals/SignInModal.tsx) already only
// renders inside the signed-in app shell.
//
// An install with no Supabase configured used to skip the gate, because the
// vault was on disk and there were no accounts to demand. Supabase is the store
// now, so an unconfigured install has nothing to show either way — the gate
// stays on and the sign-in page says what is missing, rather than letting every
// request fail deeper in with a client-construction error.
//
// There is no read-only mode any more. Every instance is writable by whoever
// runs it: generation spawns *that person's* Claude Code CLI on *their own*
// subscription (lib/generate/runner.ts), so there is no shared resource for a
// server-wide flag to protect. What an instance can actually do is decided by
// what it has — a box with no `stored` sidecar and no vault on disk fails a
// write because the write has nowhere to go, not because a flag forbade it.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// CSP connect-src/img-src are scoped to this app's own Supabase project
// origin, never a bare *.supabase.co wildcard — anyone can create a free
// Supabase project at their own subdomain, so a wildcard there would hand a
// future XSS a CSP-authorized exfiltration destination for free.
const SUPABASE_ORIGIN = SUPABASE_URL ? new URL(SUPABASE_URL).origin : "";

// The header route handlers trust in place of re-verifying the session
// themselves (see app/api/collab/route-helpers.ts's requireUser). Only
// middleware may ever set it — every request path below strips whatever a
// caller sent before writing the verified value, so there is no way for a
// client to forge it and have it survive to a route handler.
export const VERIFIED_USER_HEADER = "x-notecom-verified-user";
// The nonce app/layout.tsx reads back via next/headers to authorize its own
// explicit <script> tags under the CSP below.
const NONCE_HEADER = "x-notecom-csp-nonce";

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * A CSP with a per-request nonce, not a static one. Next.js's App Router
 * injects its own inline <script> tags on every page to stream the RSC
 * payload and drive hydration — a static `script-src 'self'` with no nonce or
 * hash blocks exactly those (`'self'` only authorizes *fetched* script files,
 * never inline content), which breaks client-side interactivity on every
 * page. Setting the nonce here, in the CSP response header, is what lets
 * Next.js self-apply it to its own generated scripts; app/layout.tsx reads
 * the forwarded request header for the one explicit script this app renders
 * (public/theme-init.js — though as a same-origin *external* file it's
 * already covered by 'self' regardless; the nonce is what the inline
 * framework scripts actually need).
 */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${SUPABASE_ORIGIN ? ` ${SUPABASE_ORIGIN}` : ""}`,
    "font-src 'self' data:",
    `connect-src 'self'${SUPABASE_ORIGIN ? ` ${SUPABASE_ORIGIN}` : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

async function verifiedUserId(req: NextRequest): Promise<string | null> {
  // No project configured: nobody can be signed in, and there is nothing to
  // read either — fall through to the redirect rather than waving the request on.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      // Middleware only reads the session here; refreshing it is the job of the
      // route handlers that own a response.
      setAll: () => {},
    },
  });
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/* --- rate limiting ---------------------------------------------------------
 *
 * In-memory, per-Edge-isolate sliding-fixed-window counters. The honest
 * caveat: Vercel's Edge Network runs many isolates across regions, each with
 * its own copy of `buckets`, and a cold start resets one to empty — this is
 * NOT a distributed guarantee, and a determined attacker spreading requests
 * across edge locations sees a higher effective ceiling than the numbers
 * below imply. It still meaningfully throttles the common case (a single
 * script or browser hammering one endpoint from one connection, which lands
 * on the same warm isolate), costs nothing, and needs no new infrastructure —
 * this app has no Redis/KV provisioned. A guaranteed-global limit needs
 * Vercel KV or Upstash and a deliberate decision to add that dependency.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

// Bounded so a flood of distinct identities (spoofed IPs hitting
// unauthenticated routes) can't grow this without limit between cold starts —
// FIFO eviction of the oldest tracked key once full, not a full clear, so
// well-behaved callers already mid-window don't get an unearned reset.
const MAX_TRACKED_KEYS = 5000;
const buckets = new Map<string, Bucket>();

/** `null` when the request is within budget; otherwise seconds until reset. */
function rateLimit(key: string, limit: number, windowMs: number): number | null {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  existing.count++;
  return existing.count > limit ? Math.ceil((existing.resetAt - now) / 1000) : null;
}

function tooManyRequests(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "too many requests — try again shortly" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

function clientIp(req: NextRequest): string {
  // Trusting the first x-forwarded-for entry is only sound because Vercel's
  // edge network sets this header itself rather than passing a client-sent
  // one through — the platform is the boundary that makes this safe to read.
  // A self-hosted deployment behind a different proxy would need to confirm
  // the same guarantee (or strip/overwrite the header at that proxy) before
  // this identity can be trusted; otherwise a client could spoof it and
  // rotate past the per-IP buckets below. Falls back to a shared bucket on a
  // setup with neither header (e.g. the desktop build talking to its own
  // local server), which only ever throttles that single local user against
  // themselves.
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// Tightest budget in the app: no session exists yet at this path, so a
// credential-stuffing run, OTP brute force, or signup-spam script is the
// threat model, not a real user's normal traffic (sign-in and sign-up each
// need at most two calls here — password/signup, then verify).
const AUTH_LIMIT = 10;
const AUTH_WINDOW_MS = 10 * 60_000;

// Generation spawns a real CLI process on the user's own machine/subscription
// — cheap for the server, but a tight budget still keeps a runaway client
// script from starting an unbounded number of concurrent runs (on top of
// MAX_CONCURRENT_JOBS in lib/generate/runner.ts, which caps in-flight jobs
// but not the *rate* of start attempts).
const GENERATE_LIMIT = 5;
const GENERATE_WINDOW_MS = 60 * 60_000;

// The blanket budget for everything else this middleware matches, pages
// included. Generous enough for real interactive use — the busiest route in
// production sees on the order of ten requests a *week* today — while still
// being a real ceiling against a scripted loop.
const GENERAL_LIMIT = 60;
const GENERAL_WINDOW_MS = 60_000;

// Paths that need a signed-in session — everything else this middleware now
// runs on (every page and API route except Next's own static asset pipeline,
// per the matcher below) gets the CSP nonce and general rate limit but no
// auth gate, same as before this pass broadened the matcher for CSP's sake.
// Exact-match set plus "/vault" itself — the original matcher's "/vault/:path*"
// matches zero or more segments, so the bare shell route (no folder open) is
// gated too; a plain `startsWith("/vault/")` requires a trailing slash and
// silently misses it.
const PROTECTED_EXACT = new Set(["/discover", "/people", "/account", "/vault"]);
function isProtected(path: string): boolean {
  return path.startsWith("/api/") || path.startsWith("/vault/") || PROTECTED_EXACT.has(path);
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const ip = clientIp(req);
  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  const withCsp = (res: NextResponse): NextResponse => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };
  // Forwards the nonce (and, when given, the verified-user header) to
  // whatever renders next — always via a fresh Headers built from the
  // inbound request, so nothing the client sent under either header name
  // survives.
  const next = (extra?: Record<string, string>): NextResponse => {
    const headers = new Headers(req.headers);
    headers.set(NONCE_HEADER, nonce);
    if (extra) for (const [k, v] of Object.entries(extra)) headers.set(k, v);
    return withCsp(NextResponse.next({ request: { headers } }));
  };

  if (path === "/api/auth/collab") {
    const retryAfter = rateLimit(`auth:${ip}`, AUTH_LIMIT, AUTH_WINDOW_MS);
    if (retryAfter !== null) return withCsp(tooManyRequests(retryAfter));
    return next();
  }

  if (!isProtected(path)) {
    // A public page (sign-in/sign-up, the marketing root, a 404): no session
    // check — that would burn a Supabase Auth round trip on every anonymous
    // page view for nothing — just the general budget, by IP.
    const retryAfter = rateLimit(`public:${ip}`, GENERAL_LIMIT, GENERAL_WINDOW_MS);
    if (retryAfter !== null) return withCsp(tooManyRequests(retryAfter));
    return next();
  }

  const userId = await verifiedUserId(req);
  if (!userId) {
    // Rate-limit unauthenticated hits by IP too — otherwise probing a gated
    // route for a valid session costs an attacker nothing but a 401.
    const retryAfter = rateLimit(`anon:${ip}`, GENERAL_LIMIT, GENERAL_WINDOW_MS);
    if (retryAfter !== null) return withCsp(tooManyRequests(retryAfter));
    if (path.startsWith("/api/")) {
      return withCsp(NextResponse.json({ error: "sign in required" }, { status: 401 }));
    }
    const to = new URL("/auth/sign-in", req.url);
    to.searchParams.set("next", path + req.nextUrl.search);
    return withCsp(NextResponse.redirect(to));
  }

  if (path === "/api/generate" && req.method === "POST") {
    const retryAfter = rateLimit(`generate:${userId}`, GENERATE_LIMIT, GENERATE_WINDOW_MS);
    if (retryAfter !== null) return withCsp(tooManyRequests(retryAfter));
  }

  const retryAfter = rateLimit(`api:${userId}`, GENERAL_LIMIT, GENERAL_WINDOW_MS);
  if (retryAfter !== null) return withCsp(tooManyRequests(retryAfter));

  // Route handlers under app/api/collab/ would otherwise call
  // supabase.auth.getUser() again for the same request — a second Supabase
  // Auth round trip to learn what this middleware already verified. Forward
  // it instead: always overwrite, never merge, so an inbound header of the
  // same name from the actual client is discarded rather than trusted.
  return next({ [VERIFIED_USER_HEADER]: userId });
}

export const config = {
  matcher: [
    // Everything except Next's own static asset/image pipeline and the
    // truly static public files — those are never dynamic HTML and need
    // neither a per-request nonce nor the auth/rate-limit logic above.
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-icon\\.png|theme-init\\.js).*)",
  ],
};
