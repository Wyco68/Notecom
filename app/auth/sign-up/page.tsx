"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthShell, { AuthFootLink } from "@/components/auth/AuthShell";
import { CollabAuthError, collabAuth, safeNext } from "@/lib/auth/collab";

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
      // A code was never sent for this one — Supabase won't confirm-email an
      // address that's already registered. Send them to sign in instead of
      // leaving them on a code screen waiting for an email that never comes.
      if (err instanceof CollabAuthError && err.code === "email_taken") {
        const to = new URL("/auth/sign-in", window.location.origin);
        to.searchParams.set("next", next);
        to.searchParams.set("email", email.trim());
        to.searchParams.set(
          "error",
          "An account already exists for that email — sign in instead."
        );
        window.location.assign(to.pathname + to.search);
        return;
      }
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
    <AuthShell
      title="Create account"
      subtitle={
        step === "form"
          ? "To share folders and join other people's."
          : `Enter the 8-digit code we emailed to ${email} to confirm your account.`
      }
      footer={
        <>
          {step === "form" && (
            <a
              href={`/auth/sign-in?next=${encodeURIComponent(next)}`}
              className="ui-focus rounded text-blue-600 transition-colors duration-150 ease-out hover:text-blue-500 dark:text-blue-400"
            >
              Already have an account? Sign in
            </a>
          )}
          <AuthFootLink href="/vault">Back to vault</AuthFootLink>
        </>
      }
    >
      {step === "form" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitForm();
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
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (8+ characters)"
            aria-label="Password"
            className="ui-field mb-3"
          />
          {error && (
            <p role="alert" className="mb-3 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !email.trim() || password.length < 8}
            className="ui-btn ui-btn-primary w-full"
          >
            {busy ? "Creating..." : "Create account"}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitCode();
          }}
        >
          <input
            autoFocus
            inputMode="numeric"
            required
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="12345678"
            aria-label="Emailed code"
            className="ui-field mb-3 text-center font-mono text-lg tracking-[0.3em]"
          />
          {error && (
            <p role="alert" className="mb-3 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="ui-btn ui-btn-primary w-full"
          >
            {busy ? "Verifying..." : "Confirm and continue"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
