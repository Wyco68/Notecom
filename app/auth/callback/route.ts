import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { collabEnabled, createClient } from "@/lib/supabase/server";

// Landing point for the password-recovery link (the app's only link-based
// flow — sign-in and sign-up use typed codes). Supabase sends the user back
// here with either a PKCE `code` to exchange, or a `token_hash` + `type` to
// verify directly; both end in a session cookie and neither is stored.

const OTP_TYPES = new Set<string>([
  "email",
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
]);

export async function GET(req: NextRequest) {
  if (!collabEnabled()) {
    return NextResponse.redirect(new URL("/vault", req.url));
  }
  const params = req.nextUrl.searchParams;
  const next = params.get("next") ?? "/vault";
  const failed = (message: string) =>
    NextResponse.redirect(
      new URL(`/auth/sign-in?error=${encodeURIComponent(message)}`, req.url)
    );

  // Supabase reports a refused or expired link in the query, not in a body.
  const sent = params.get("error_description") ?? params.get("error");
  if (sent) return failed(sent);

  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") ?? "";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // The PKCE verifier lives in the cookies of the browser that asked for the
    // link, so a link opened in a different browser fails here too — the user
    // can't tell the two apart, so neither does the message.
    if (error) {
      return failed(
        "this link is expired, already used, or was opened in a different browser — request a new one"
      );
    }
  } else if (tokenHash && OTP_TYPES.has(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (error) return failed("this link has expired — request a new one");
  }

  // Relative only: an absolute `next` would make this an open redirect.
  return NextResponse.redirect(new URL(next.startsWith("/") ? next : "/vault", req.url));
}
