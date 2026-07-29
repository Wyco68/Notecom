import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { collabEnabled, createClient } from "@/lib/supabase/server";

// Collaboration account auth: password sign-in with a mandatory email second
// factor, plus sign-up and password reset. Distinct from /api/auth (the local
// Claude Code CLI sign-in) — this identifies a person to other people.
//
// The security model is the whole point of this file:
//   - The password is checked here but NEVER mints a browser session. That
//     check runs against an in-memory cookie jar (`ephemeralClient`), so
//     Supabase's session cookies land in a throwaway map and the caller's real
//     cookies are untouched. A correct password alone gets you nothing.
//   - The ONLY thing that mints a real session is `verifyOtp` on the 8-digit
//     code emailed to the account owner (`createClient` — cookie-bound). So a
//     session requires BOTH factors: password (to trigger the code) and the
//     emailed code (to mint the session). No forgeable "mfa_ok" flag, no
//     middleware gate — the second factor is structural.
//   - Codes, not magic links, for getting in: sign-up and sign-in are typed
//     codes, so nothing ever follows the email's link and the project's Auth
//     "Site URL" is never hit.
//
// Password recovery is the deliberate exception: there is no password to prove
// with, so it runs on the emailed link. `reset` therefore requests it from the
// cookie-bound client (the PKCE verifier must survive in the caller's browser
// or /auth/callback cannot exchange the code), the link lands on
// /auth/callback, and `set-password` writes the new password using the session
// that exchange produced.
//
// Required Supabase email templates: "Confirm signup" and "Magic Link" must
// expose {{ .Token }} (no code, no sign-in), while "Reset Password" keeps the
// default {{ .ConfirmationURL }} link. "Confirm email" must stay ON, and the
// app's /auth/callback URL must be in the project's Redirect URLs.

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// A Supabase server client whose cookies go to an in-memory jar instead of the
// response, so operations that would establish a session (signInWithPassword,
// signUp) validate credentials without persisting one. Used for every step
// that must NOT log the caller in.
function ephemeralClient() {
  const jar = new Map<string, string>();
  return createServerClient(URL!, ANON_KEY!, {
    cookies: {
      getAll() {
        return [...jar].map(([name, value]) => ({ name, value }));
      },
      setAll(list) {
        for (const { name, value } of list) jar.set(name, value);
      },
    },
  });
}

const bad = (msg: string, status = 400) =>
  NextResponse.json({ error: msg }, { status });

// Where the recovery link comes back to. Built from the request so a desktop
// build (localhost) and a hosted reader each get their own origin; both must be
// listed in the project's Redirect URLs.
const recoveryRedirect = (req: NextRequest) =>
  `${req.nextUrl.origin}/auth/callback?next=${encodeURIComponent("/auth/reset?stage=set")}`;

export async function POST(req: NextRequest) {
  if (!collabEnabled()) return bad("accounts are not configured on this server", 501);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("invalid body");
  }
  const action = String(body.action ?? "");
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const token = String(body.token ?? "").trim();

  switch (action) {
    // --- sign up: create the account, then email a confirmation code ---
    case "signup": {
      if (!email || password.length < 8) {
        return bad("email and a password of at least 8 characters are required");
      }
      const { error } = await ephemeralClient().auth.signUp({ email, password });
      // A duplicate email is reported generically so this can't be used to
      // enumerate who already has an account.
      if (error) return bad("could not create the account", 400);
      return NextResponse.json({ ok: true, factor: "signup" });
    }

    // --- sign in step 1: verify the password, then email a login code ---
    case "password": {
      if (!email || !password) return bad("email and password are required");
      const client = ephemeralClient();
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) return bad("invalid email or password", 401);
      // Password is correct but the ephemeral session is discarded. Email the
      // second factor; the session is only minted once it is verified.
      const otp = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      if (otp.error) return bad("could not send the verification code", 502);
      return NextResponse.json({ ok: true, factor: "email" });
    }

    // --- step 2 (sign in OR sign up): the emailed code mints the session ---
    case "verify": {
      if (!email || !/^\d{4,10}$/.test(token)) return bad("email and the emailed code are required");
      const type = body.factor === "signup" ? "signup" : "email";
      const supabase = await createClient(); // cookie-bound: this sets the session
      const { error } = await supabase.auth.verifyOtp({ email, token, type });
      if (error) return bad("invalid or expired code", 401);
      return NextResponse.json({ ok: true });
    }

    // --- reset step 1: email a recovery link (also how a magic-link-only
    //     account gets its first password) ---
    case "reset": {
      if (!email) return bad("email is required");
      // Cookie-bound on purpose, unlike every other pre-session step: this
      // stores the PKCE code verifier in the caller's browser, and without it
      // /auth/callback cannot exchange the link's code. It mints no session.
      const supabase = await createClient();
      // Errors are swallowed so a caller can't learn whether the email exists.
      await supabase.auth
        .resetPasswordForEmail(email, { redirectTo: recoveryRedirect(req) })
        .catch(() => {});
      return NextResponse.json({ ok: true, factor: "recovery" });
    }

    // --- reset step 2: the recovery link has already been exchanged for a
    //     session by /auth/callback; write the new password with it ---
    case "set-password": {
      if (password.length < 8) {
        return bad("a password of at least 8 characters is required");
      }
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      if (!data.user) return bad("the recovery link has expired — request a new one", 401);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return bad("could not set the password", 400);
      return NextResponse.json({ ok: true });
    }

    default:
      return bad("unknown action");
  }
}
