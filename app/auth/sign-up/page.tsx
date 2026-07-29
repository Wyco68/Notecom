"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { collabAuth, safeNext } from "@/lib/auth/collab";

// Create a collaboration account: email + password, then confirm ownership of
// the inbox with the 8-digit code Supabase emails. The account exists after
// this; from then on sign-in is password + emailed code (see the sign-in page
// and app/api/auth/collab/route.ts).

function SignUpForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [step, setStep] = useState<"form" | "code">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitForm() {
    if (!email.trim() || password.length < 8) {
      setError("Enter an email and a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await collabAuth("signup", { email: email.trim(), password });
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
      await collabAuth("verify", { email: email.trim(), token: code.trim(), factor: "signup" });
      window.location.assign(next);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1.5 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
        Create account
      </h1>
      <p className="mb-8 text-sm text-gray-500 dark:text-gray-400">
        To share folders and join other people&apos;s.
      </p>

      {step === "form" ? (
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
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitForm()}
            placeholder="Password (8+ characters)"
            className="ui-field mb-3"
          />
          {error && <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button
            onClick={submitForm}
            disabled={busy || !email.trim() || password.length < 8}
            className="ui-btn ui-btn-primary w-full"
          >
            {busy ? "Creating..." : "Create account"}
          </button>
          <a
            href={`/auth/sign-in?next=${encodeURIComponent(next)}`}
            className="ui-focus mt-5 rounded text-center text-sm text-blue-600 transition-colors duration-150 ease-out hover:text-blue-500 dark:text-blue-400"
          >
            Already have an account? Sign in
          </a>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
            Enter the 8-digit code we emailed to {email} to confirm your account.
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
            {busy ? "Verifying..." : "Confirm and continue"}
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

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
