"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { collabAuth, safeNext } from "@/lib/auth/collab";

// Account sign-in for collaboration. Distinct from the Claude Code CLI
// sign-in in components/modals/SignInModal.tsx: that one authorises the local
// generation tool, this one identifies a person to other people.
//
// Two factors, always: password proves who you are, then an 8-digit code
// emailed to the account proves you hold the inbox. The password never mints a
// session on its own — only verifying the emailed code does (see
// app/api/auth/collab/route.ts). The code is typed, so no email link is
// followed and no redirect to the project's Site URL happens. The one
// link-based flow is password recovery, on /auth/reset.

function SignInForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [step, setStep] = useState<"password" | "code">("password");
  // Prefilled when redirected here from sign-up after "an account already
  // exists for that email" — the reader shouldn't have to retype it.
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));

  async function submitPassword() {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await collabAuth("password", { email: email.trim(), password });
      setStep("code");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await collabAuth("verify", { email: email.trim(), token: code.trim(), factor: "email" });
      window.location.assign(next);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1.5 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
        Sign in
      </h1>
      <p className="mb-8 text-sm text-gray-500 dark:text-gray-400">
        To share folders and join other people&apos;s.
      </p>

      {step === "password" ? (
        <>
          <input
            autoFocus
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="ui-field mb-3"
          />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitPassword()}
            placeholder="Password"
            className="ui-field mb-3"
          />
          {error && <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button
            onClick={submitPassword}
            disabled={busy || !email.trim() || !password}
            className="ui-btn ui-btn-primary w-full"
          >
            {busy ? "Checking..." : "Continue"}
          </button>
          <div className="mt-5 flex justify-between text-sm">
            <a
              href={`/auth/sign-up?next=${encodeURIComponent(next)}`}
              className="ui-focus rounded text-blue-600 transition-colors duration-150 ease-out hover:text-blue-500 dark:text-blue-400"
            >
              Create account
            </a>
            <a
              href={`/auth/reset?next=${encodeURIComponent(next)}`}
              className="ui-focus rounded text-blue-600 transition-colors duration-150 ease-out hover:text-blue-500 dark:text-blue-400"
            >
              Forgot password?
            </a>
          </div>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
            Enter the 8-digit code we emailed to {email}.
          </p>
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitCode()}
            placeholder="12345678"
            className="ui-field mb-3 text-center font-mono text-lg tracking-[0.3em]"
          />
          {error && <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button
            onClick={submitCode}
            disabled={busy || !code.trim()}
            className="ui-btn ui-btn-primary w-full"
          >
            {busy ? "Verifying..." : "Verify and sign in"}
          </button>
          <button
            onClick={() => {
              setStep("password");
              setCode("");
              setError(null);
            }}
            className="ui-focus mt-4 rounded text-center text-sm text-blue-600 transition-colors duration-150 ease-out hover:text-blue-500 dark:text-blue-400"
          >
            Back
          </button>
        </>
      )}

      <a
        href="/vault"
        className="ui-focus mt-8 rounded text-center text-sm text-gray-500 transition-colors duration-150 ease-out hover:text-gray-700 dark:hover:text-gray-300"
      >
        Back to vault
      </a>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
