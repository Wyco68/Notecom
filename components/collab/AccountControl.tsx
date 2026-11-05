"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
//
// It renders its own *contents* only — the bordered foot row around it belongs
// to AppShell, which also puts the app-level chrome (theme, refresh) in that
// row. That split is what keeps the theme toggle reachable on a build with no
// collaboration at all, where this component returns null.
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

  // Nothing at all on a build without collaboration; a placeholder at the
  // identity's own size while the profile loads. Returning null there let the
  // chrome cluster sit left, then jump right when the name arrived.
  if (!ENABLED) return null;
  if (!ready) {
    return (
      <div className="flex min-w-0 flex-1 animate-pulse items-center gap-2 px-1.5 py-1" aria-hidden>
        <span className="h-7 w-7 shrink-0 rounded-full bg-ink/[0.08]" />
        <span className="h-2.5 w-20 rounded bg-ink/[0.08]" />
      </div>
    );
  }

  async function signOut() {
    await createClient().auth.signOut();
    // A full reload is simplest and safest: it drops any server-rendered view
    // that assumed a session, rather than trying to invalidate each in place.
    window.location.reload();
  }

  if (!username) {
    return (
      <a
        href="/auth/sign-in"
        className="ui-focus min-w-0 flex-1 truncate rounded px-1.5 text-sm font-medium text-accent transition-colors duration-150 ease-out hover:text-accent/80"
      >
        Sign in
      </a>
    );
  }

  return (
    <>
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
        className="ui-btn ui-btn-xs shrink-0 font-normal text-muted hover:bg-ink/[0.06] hover:text-ink"
      >
        Sign out
      </button>
    </>
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
  const className = `ui-row group flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left text-sm ${
    active ? "ui-row-on" : "text-ink-2"
  }`;

  const face = (
    <>
      <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full border border-cover-line bg-paper">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed
          // Storage URL is short-lived and per-request, so next/image's
          // optimiser has nothing stable to cache.
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <UserIcon className="absolute inset-0 m-auto h-4 w-4 text-muted" />
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
