"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { collabAuth, safeNext } from "@/lib/auth/collab";

// Account sign-in for collaboration. Distinct from the Claude Code CLI
// sign-in in components/modals/SignInModal.tsx: that one authorises the local
// generation tool, this one identifies a person to other people.
//
// Two factors, always: password proves who you are, then a 6-digit code
// emailed to the account proves you hold the inbox. The password never mints a
// session on its own — only verifying the emailed code does (see
// app/api/auth/collab/route.ts). The code is typed, so no email link is
// followed and no redirect to the project's Site URL happens.

function SignInForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [step, setStep] = useState<"password" | "code">("password");
  const [email, setEmail] = useState("");
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
      <h1 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">Sign in</h1>
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
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
            className="mb-3 w-full rounded border border-black/10 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
          />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitPassword()}
            placeholder="Password"
            className="mb-3 w-full rounded border border-black/10 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
          />
          {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
          <button
            onClick={submitPassword}
            disabled={busy || !email.trim() || !password}
            className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? "Checking..." : "Continue"}
          </button>
          <div className="mt-4 flex justify-between text-sm">
            <a href={`/auth/sign-up?next=${encodeURIComponent(next)}`} className="text-blue-500 hover:text-blue-400">
              Create account
            </a>
            <a href={`/auth/reset?next=${encodeURIComponent(next)}`} className="text-blue-500 hover:text-blue-400">
              Forgot password?
            </a>
          </div>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
            Enter the 6-digit code we emailed to {email}.
          </p>
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitCode()}
            placeholder="123456"
            className="mb-3 w-full rounded border border-black/10 bg-gray-50 px-3 py-2 text-center font-mono text-lg tracking-widest text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
          />
          {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
          <button
            onClick={submitCode}
            disabled={busy || !code.trim()}
            className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? "Verifying..." : "Verify and sign in"}
          </button>
          <button
            onClick={() => {
              setStep("password");
              setCode("");
              setError(null);
            }}
            className="mt-3 text-center text-sm text-blue-500 hover:text-blue-400"
          >
            Back
          </button>
        </>
      )}

      <a href="/vault" className="mt-6 text-center text-sm text-gray-500 hover:text-gray-400">
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
