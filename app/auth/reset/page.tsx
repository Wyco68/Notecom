"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
        {openedFromLink ? "Choose a new password" : "Set a password"}
      </h1>
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
        {openedFromLink
          ? "This finishes the reset — you'll be signed in with it."
          : "We'll email you a link to confirm it's you."}
      </p>

      {openedFromLink ? (
        <>
          <input
            autoFocus
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitPassword()}
            placeholder="New password (8+ characters)"
            className="mb-3 w-full rounded border border-black/10 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
          />
          {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
          <button
            onClick={submitPassword}
            disabled={busy || password.length < 8}
            className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? "Saving..." : "Set password and continue"}
          </button>
        </>
      ) : sent ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          If {email} has an account, a reset link is on its way. Open it in this
          browser and you&apos;ll come straight back here to choose a new
          password. The link expires in an hour.
        </p>
      ) : (
        <>
          <input
            autoFocus
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendLink()}
            placeholder="you@example.com"
            className="mb-3 w-full rounded border border-black/10 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
          />
          {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
          <button
            onClick={sendLink}
            disabled={busy || !email.trim()}
            className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? "Sending..." : "Email me a reset link"}
          </button>
        </>
      )}

      <a
        href={`/auth/sign-in?next=${encodeURIComponent(next)}`}
        className="mt-6 text-center text-sm text-gray-500 hover:text-gray-400"
      >
        Back to sign in
      </a>
    </main>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
