"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import SignOutIcon from "../icons/SignOutIcon";
import UserIcon from "../icons/UserIcon";

// The sidebar's foot: who is signed in, a way into their profile, and sign out.
// Distinct from the Claude Code CLI sign-in (which authorises the local
// generation tool) — this identifies a person to other people.
//
// There is no separate "Settings" control: it went to the same place the
// identity itself does, so the identity *is* the control. `onOpenProfile` opens
// the editor in the content column; without it (or when it returns false) the
// row falls back to navigating to /account.
//
// Renders nothing when collaboration isn't configured on this build, so a
// purely-local install shows no orphaned account UI.
const ENABLED = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

export default function AccountControl({
  onOpenProfile,
  active,
}: {
  onOpenProfile?: () => void;
  active?: boolean;
}) {
  const [username, setUsername] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ENABLED) return;
    const supabase = createClient();

    async function load() {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setUsername(null);
        setAvatarUrl(null);
        setReady(true);
        return;
      }
      // profiles is readable per RLS; fall back to the email local-part so the
      // control never renders blank for a signed-in user. The photo comes from
      // /api/collab/me/profile because the bucket is private and only the
      // server mints the signed URL that makes a stored path loadable.
      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", data.user.id)
        .maybeSingle();
      setUsername(profile?.username ?? data.user.email?.split("@")[0] ?? "account");
      try {
        const res = await fetch("/api/collab/me/profile");
        setAvatarUrl(res.ok ? ((await res.json()).profile?.avatarUrl ?? null) : null);
      } catch {
        setAvatarUrl(null);
      }
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

  if (!username) {
    return (
      <div className="border-t border-black/10 px-3 py-2.5 text-xs dark:border-white/10">
        <a
          href="/auth/sign-in"
          className="ui-focus rounded text-blue-600 transition-colors duration-150 ease-out hover:text-blue-500 dark:text-blue-400"
        >
          Sign in to share folders
        </a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 border-t border-black/10 px-2 py-2 dark:border-white/10">
      {/* The identity is the button. It opens the profile editor in place when
          the shell offers that, and navigates only as a fallback. */}
      <ProfileButton
        username={username}
        avatarUrl={avatarUrl}
        active={active}
        onOpen={onOpenProfile}
      />

      <button
        onClick={signOut}
        title="Sign out"
        aria-label="Sign out"
        className="ui-btn ui-btn-xs group shrink-0 gap-1.5 rounded-md border border-black/10 font-normal text-gray-600 transition-[color,background-color,border-color,transform] duration-150 ease-out hover:-translate-y-px hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600 focus-visible:ring-red-600/70 dark:border-white/10 dark:text-gray-300 dark:hover:text-red-400 dark:focus-visible:ring-red-500/70"
      >
        <SignOutIcon className="h-3.5 w-3.5 transition-transform duration-150 ease-out group-hover:translate-x-0.5" />
        Sign out
      </button>
    </div>
  );
}

/**
 * Avatar + username, as one control. Rendered as a `<button>` when the shell
 * can show the editor in place and as an `<a>` when it can't, because a link
 * that doesn't navigate and a button that does are both lies about what will
 * happen.
 */
function ProfileButton({
  username,
  avatarUrl,
  active,
  onOpen,
}: {
  username: string;
  avatarUrl: string | null;
  active?: boolean;
  onOpen?: () => void;
}) {
  const className = `ui-row group flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left text-xs ${
    active
      ? "bg-blue-600/10 text-blue-700 dark:bg-blue-600/20 dark:text-blue-300"
      : "text-gray-700 dark:text-gray-300"
  }`;

  const face = (
    <>
      <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full border border-black/10 bg-black/[0.03] transition-transform duration-150 ease-out group-hover:scale-105 dark:border-white/10 dark:bg-white/[0.06]">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed
          // Storage URL is short-lived and per-request, so next/image's
          // optimiser has nothing stable to cache.
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <UserIcon className="absolute inset-0 m-auto h-4 w-4 text-gray-400 dark:text-gray-500" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{username}</span>
    </>
  );

  if (onOpen) {
    return (
      <button onClick={onOpen} title="Your profile" className={className}>
        {face}
      </button>
    );
  }
  return (
    <a href="/account" title="Your profile" className={className}>
      {face}
    </a>
  );
}
