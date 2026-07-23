"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Account sign-in for collaboration. Distinct from the Claude Code CLI
// sign-in in components/modals/SignInModal.tsx: that one authorises the local
// generation tool, this one identifies a person to other people.
function SignInForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));

  async function send() {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const next = params.get("next") ?? "/vault";
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) throw new Error(error.message);
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">Sign in</h1>
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
        To share folders and join other people&apos;s.
      </p>

      {sent ? (
        <p className="rounded border border-emerald-800/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
          Check your email for a sign-in link.
        </p>
      ) : (
        <>
          <input
            autoFocus
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="you@example.com"
            className="mb-3 w-full rounded border border-black/10 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
          />
          {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
          <button
            onClick={send}
            disabled={busy || !email.trim()}
            className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? "Sending..." : "Email me a link"}
          </button>
        </>
      )}

      <a href="/vault" className="mt-6 text-center text-sm text-blue-500 hover:text-blue-400">
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
