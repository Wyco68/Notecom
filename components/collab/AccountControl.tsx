"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Collaboration account state for the sidebar: who is signed in, plus sign
// out. Distinct from the Claude Code CLI sign-in (which authorises the local
// generation tool) — this identifies a person to other people.
//
// Renders nothing when collaboration isn't configured on this build, so a
// purely-local install shows no orphaned account UI.
const ENABLED = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

export default function AccountControl() {
  const [username, setUsername] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ENABLED) return;
    const supabase = createClient();

    async function load() {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setUsername(null);
        setReady(true);
        return;
      }
      // profiles is readable per RLS; fall back to the email local-part so the
      // control never renders blank for a signed-in user.
      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", data.user.id)
        .maybeSingle();
      setUsername(profile?.username ?? data.user.email?.split("@")[0] ?? "account");
      setReady(true);
    }

    load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => load());
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ENABLED || !ready) return null;

  async function signOut() {
    await createClient().auth.signOut();
    // A full reload is simplest and safest: it drops any server-rendered view
    // that assumed a session, rather than trying to invalidate each in place.
    window.location.reload();
  }

  return (
    <div className="flex items-center justify-between border-t border-black/10 px-3 py-2 text-xs dark:border-white/10">
      {username ? (
        <>
          <a
            href="/account"
            title="Account settings"
            className="min-w-0 truncate text-gray-600 hover:text-blue-600 dark:text-gray-300 dark:hover:text-blue-400"
          >
            <span className="text-gray-400">signed in as </span>
            {username}
          </a>
          <div className="flex shrink-0 items-center gap-1">
            <a
              href="/account"
              className="rounded px-1.5 py-0.5 text-gray-500 hover:bg-black/5 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200"
            >
              Settings
            </a>
            <button
              onClick={signOut}
              className="rounded px-1.5 py-0.5 text-gray-500 hover:bg-black/5 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200"
            >
              Sign out
            </button>
          </div>
        </>
      ) : (
        <a
          href="/auth/sign-in"
          className="text-blue-600 hover:text-blue-500 dark:text-blue-400"
        >
          Sign in to share folders
        </a>
      )}
    </div>
  );
}
