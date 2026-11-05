"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthShell, { AuthFootLink } from "@/components/auth/AuthShell";
import { collabAuth, safeNext } from "@/lib/auth/collab";

// Set or reset a password. Also the path an older, magic-link-only account uses
// to get its first password. Unlike sign-in and sign-up (typed 8-digit codes),
// recovery runs on the emailed link: there is no password left to prove with,
// so holding the inbox is the only factor available. The link lands on
// /auth/callback, which exchanges it for a session; this page then only has to
// collect the new password.

function ResetForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  // Set by the link's redirect target — the session already exists by now.
  const openedFromLink = params.get("stage") === "set";
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink() {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await collabAuth("reset", { email: email.trim() });
      // Always advances: the server never reveals whether the email exists.
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword() {
    if (password.length < 8) {
      setError("Choose a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await collabAuth("set-password", { password });
      window.location.assign(next);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={openedFromLink ? "Choose a new password" : "Set a password"}
      subtitle={
        openedFromLink
          ? "You'll be signed in with it."
          : sent
            ? "Check your inbox."
            : "We'll email you a link."
      }
      footer={
        <AuthFootLink href={`/auth/sign-in?next=${encodeURIComponent(next)}`}>
          Back to sign in
        </AuthFootLink>
      }
    >
      {openedFromLink ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitPassword();
          }}
        >
          <input
            autoFocus
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password (8+ characters)"
            aria-label="New password"
            className="ui-field mb-3"
          />
          {error && (
            <p role="alert" className="mb-3 text-xs text-danger">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || password.length < 8}
            className="ui-btn ui-btn-primary w-full"
          >
            {busy ? "Saving..." : "Set password and continue"}
          </button>
        </form>
      ) : sent ? (
        <p className="text-sm leading-relaxed text-ink-2">
          If {email} has an account, a link is on its way. Open it in this browser. It expires in an hour.
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendLink();
          }}
        >
          <input
            autoFocus
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email"
            className="ui-field mb-3"
          />
          {error && (
            <p role="alert" className="mb-3 text-xs text-danger">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="ui-btn ui-btn-primary w-full"
          >
            {busy ? "Sending..." : "Email me a reset link"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
