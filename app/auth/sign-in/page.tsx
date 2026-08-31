"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthShell, { AuthFootLink } from "@/components/auth/AuthShell";
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
//
// Each step is a real <form>: Enter already submitted via a keydown handler,
// but only a form gets browsers and password managers to treat these as
// credentials — autofill, "save this password", and the Go key on a phone
// keyboard all key off the form, not off the input.

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
    <AuthShell
      title="Sign in"
      subtitle={
        step === "password"
          ? "To share folders and join other people's."
          : `Enter the 8-digit code we emailed to ${email}.`
      }
      footer={
        <>
          {step === "password" && (
            <div className="flex justify-between">
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
          )}
          <AuthFootLink href="/vault">Back to vault</AuthFootLink>
        </>
      }
    >
      {step === "password" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitPassword();
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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
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
            disabled={busy || !email.trim() || !password}
            className="ui-btn ui-btn-primary w-full"
          >
            {busy ? "Checking..." : "Continue"}
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
            {busy ? "Verifying..." : "Verify and sign in"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("password");
              setCode("");
              setError(null);
            }}
            className="ui-focus mt-4 w-full rounded text-center text-sm text-blue-600 transition-colors duration-150 ease-out hover:text-blue-500 dark:text-blue-400"
          >
            Back
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
