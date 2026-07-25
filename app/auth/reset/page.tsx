"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { collabAuth, safeNext } from "@/lib/auth/collab";

// Set or reset a password. Also the path an older, magic-link-only account
// uses to get its first password: request a recovery code, then verify it and
// choose a password. Code-based, so no email link is followed and no redirect
// to the project's Site URL happens.

function ResetForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await collabAuth("reset", { email: email.trim() });
      // Always advances: the server never reveals whether the email exists.
      setStep("reset");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitReset() {
    if (!code.trim() || password.length < 8) {
      setError("Enter the code and a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await collabAuth("reset-verify", {
        email: email.trim(),
        token: code.trim(),
        password,
      });
      window.location.assign(next);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">Set a password</h1>
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
        We&apos;ll email you a code to confirm it&apos;s you.
      </p>

      {step === "email" ? (
        <>
          <input
            autoFocus
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendCode()}
            placeholder="you@example.com"
            className="mb-3 w-full rounded border border-black/10 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
          />
          {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
          <button
            onClick={sendCode}
            disabled={busy || !email.trim()}
            className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? "Sending..." : "Email me a code"}
          </button>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
            Enter the 6-digit code sent to {email} and choose a new password.
          </p>
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="mb-3 w-full rounded border border-black/10 bg-gray-50 px-3 py-2 text-center font-mono text-lg tracking-widest text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
          />
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitReset()}
            placeholder="New password (8+ characters)"
            className="mb-3 w-full rounded border border-black/10 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
          />
          {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
          <button
            onClick={submitReset}
            disabled={busy || !code.trim() || password.length < 8}
            className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? "Saving..." : "Set password and sign in"}
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
