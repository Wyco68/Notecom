"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthShell, { AuthFootLink } from "@/components/auth/AuthShell";
import { CollabAuthError, collabAuth, safeNext } from "@/lib/auth/collab";

// Create a collaboration account: email + password, then confirm ownership of
// the inbox with the 8-digit code Supabase emails. The account exists after
// this; from then on sign-in is password + emailed code (see the sign-in page
// and app/api/auth/collab/route.ts).
//
// Every field says what it wants before it is filled in, and every refusal is
// shown against the field it is about. This used to be two placeholders and one
// line of red text under the form, which meant a rejected sign-up said
// "couldn't create that account" and nothing else — the one thing the person
// filling it in cannot act on. The rules themselves live on the server and in
// the Supabase project's own password policy; these are the same rules stated
// early, not a second copy of them (the server still refuses what it refuses,
// and its message wins over anything guessed here).

/** The address has to be able to receive the confirmation code, so shape it. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

/**
 * Which field a server refusal belongs to, when it says.
 *
 * The route forwards Supabase's own message for the fixable failures — a
 * password under the project's policy, a malformed address, signups disabled,
 * the hourly email cap. The first two name a field and belong next to it; the
 * rest are about the server, not the form, and stay at the bottom.
 */
function fieldForError(message: string): "email" | "password" | null {
  const m = message.toLowerCase();
  if (m.includes("password")) return "password";
  if (/invalid format|unable to validate email|valid email/.test(m)) return "email";
  return null;
}

function SignUpForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [step, setStep] = useState<"form" | "code">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  // Split three ways so a refusal can be shown against the field it is about.
  // `error` is what is left: something true of the request, not of one field.
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function clearErrors() {
    setEmailError(null);
    setPasswordError(null);
    setError(null);
  }

  async function submitForm() {
    clearErrors();

    // Checked here only to answer immediately; the server checks the same
    // things and its answer is the one that counts. The submit button is never
    // disabled for a failed check — a dead button explains nothing, and
    // explaining is the entire job of this screen.
    const trimmed = email.trim();
    let stop = false;
    if (!EMAIL_RE.test(trimmed)) {
      setEmailError("Enter an email address in the form you@example.com.");
      stop = true;
    }
    if (password.length < MIN_PASSWORD) {
      setPasswordError(
        `Use at least ${MIN_PASSWORD} characters — this one has ${password.length}.`
      );
      stop = true;
    }
    if (stop) return;

    setBusy(true);
    try {
      await collabAuth("signup", { email: trimmed, password });
      setStep("code");
    } catch (err: any) {
      // A code was never sent for this one — Supabase won't confirm-email an
      // address that's already registered. Send them to sign in instead of
      // leaving them on a code screen waiting for an email that never comes.
      if (err instanceof CollabAuthError && err.code === "email_taken") {
        const to = new URL("/auth/sign-in", window.location.origin);
        to.searchParams.set("next", next);
        to.searchParams.set("email", trimmed);
        to.searchParams.set(
          "error",
          "An account already exists for that email — sign in instead."
        );
        window.location.assign(to.pathname + to.search);
        return;
      }
      const message = String(err?.message ?? "could not create the account");
      const field = fieldForError(message);
      if (field === "email") setEmailError(message);
      else if (field === "password") setPasswordError(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    clearErrors();
    const digits = code.trim();
    // Digits only, and the length the route accepts (4-10) rather than the 8
    // the email currently sends: the code length is a Supabase project
    // setting, and hardcoding today's value here would invent a dead end the
    // server does not have.
    if (!/^\d{4,10}$/.test(digits)) {
      setError("The code is the digits from the email — no spaces or letters.");
      return;
    }
    setBusy(true);
    try {
      await collabAuth("verify", { email: email.trim(), token: digits, factor: "signup" });
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
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submitForm();
          }}
        >
          <Field
            label="Email"
            hint="We send an 8-digit confirmation code here, so use an inbox you can open now."
            error={emailError}
          >
            {(props) => (
              <input
                {...props}
                autoFocus
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailError(null);
                }}
                placeholder="you@example.com"
              />
            )}
          </Field>

          <Field
            label="Password"
            hint={`At least ${MIN_PASSWORD} characters. Letters, numbers and symbols all count.`}
            error={passwordError}
          >
            {(props) => (
              <input
                {...props}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError(null);
                }}
                placeholder={`${MIN_PASSWORD}+ characters`}
              />
            )}
          </Field>

          {error && <FormError>{error}</FormError>}

          <button type="submit" disabled={busy} className="ui-btn ui-btn-primary w-full">
            {busy ? "Creating..." : "Create account"}
          </button>
        </form>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submitCode();
          }}
        >
          <Field
            label="Emailed code"
            hint="Eight digits, from the message just sent. It can take a minute, and it may land in spam."
            error={null}
          >
            {(props) => (
              <input
                {...props}
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={10}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setError(null);
                }}
                placeholder="12345678"
                className="ui-field text-center font-mono text-lg tracking-[0.3em]"
              />
            )}
          </Field>

          {error && <FormError>{error}</FormError>}

          <button type="submit" disabled={busy} className="ui-btn ui-btn-primary w-full">
            {busy ? "Verifying..." : "Confirm and continue"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

/**
 * One labelled field: what it is, what it wants, and what was wrong with it.
 *
 * The label is a real `<label>` rather than the `aria-label` these inputs used
 * to carry — a placeholder disappears the moment someone types, which is
 * exactly when they are most likely to want to know what the box was for. The
 * hint is wired through `aria-describedby` and the error through
 * `aria-errormessage`, so a screen reader hears the rule before the field and
 * the refusal with it, not a bare "invalid".
 *
 * `children` is a render prop because the id, the describedby and the error
 * state have to land on the input itself, and the two inputs that need a
 * different `className` (the code box) can still override it.
 */
function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint: string;
  error: string | null;
  children: (props: {
    id: string;
    className: string;
    "aria-describedby": string;
    "aria-invalid": boolean;
    "aria-errormessage"?: string;
  }) => React.ReactNode;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className="mb-4">
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
      >
        {label}
      </label>
      <p id={hintId} className="mb-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        {hint}
      </p>
      {children({
        id,
        className: `ui-field${
          error ? " border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/25" : ""
        }`,
        "aria-describedby": hintId,
        "aria-invalid": !!error,
        ...(error ? { "aria-errormessage": errorId } : {}),
      })}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-1.5 text-xs leading-relaxed text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** A refusal about the request rather than about one field. */
function FormError({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="mb-3 rounded-md border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-xs leading-relaxed text-red-700 dark:text-red-400"
    >
      {children}
    </p>
  );
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
