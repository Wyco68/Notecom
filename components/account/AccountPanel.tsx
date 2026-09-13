"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import UserIcon from "@/components/icons/UserIcon";
import ConfirmModal from "@/components/modals/ConfirmModal";
import PanelHeader from "@/components/layout/PanelHeader";
import { SkeletonPanel } from "@/components/layout/Skeleton";
import { useToast } from "@/components/toast/ToastProvider";
import { AVATAR_ACCEPT, AVATAR_MAX_BYTES } from "@/lib/collab/avatar";

// Account settings. Profile and tags are editable here; email and password are
// not — those go through the existing /auth flow, which already enforces the
// emailed-code second factor. Reimplementing them here would be a second,
// weaker path to the same credential.
//
// Rendered in two places from one definition: inside the workspace's content
// column (AppShell, with `onClose`) and as the standalone /account page (no
// `onClose`, which is what a deep link or an auth `?next=/account` lands on).

// People lists are fetched a page at a time, never whole — same rule as the
// folder console.
const PAGE = 10;

interface Profile {
  username: string | null;
  email: string | null;
  avatarUrl: string | null;
  createdAt: string | null;
  /** ISO date the next rename is allowed, or null when it is allowed now. */
  usernameChangeableAt: string | null;
  usernameCooldownDays: number;
}

export default function AccountPanel({
  onClose,
  onOpenPeople,
}: {
  onClose?: () => void;
  /** Opens the People panel in the content column; falls back to `/people`. */
  onOpenPeople?: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState("");
  // Follow lists fetch their own page; bumping this makes them re-read after a
  // follow or unfollow.
  const [followRevision, setFollowRevision] = useState(0);
  const [followName, setFollowName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const pRes = await fetch("/api/collab/me/profile");
      if (pRes.ok) {
        const { profile } = await pRes.json();
        setProfile(profile);
        setUsername(profile.username ?? "");
      }
      setFollowRevision((n) => n + 1);
    } finally {
      setLoaded(true);
    }
  }, []);

  /** Every mutation here follows the same shape: call, toast, reload. */
  const act = useCallback(
    async (path: string, init: RequestInit, okMessage: string) => {
      setBusy(true);
      try {
        const res = await fetch(path, {
          // FormData sets its own multipart boundary; forcing JSON would break it.
          headers: init.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
          ...init,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "failed");
        toast.success(okMessage);
        await load();
        return true;
      } catch (err: any) {
        toast.error(err.message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load, toast]
  );

  async function doFollow() {
    const name = followName.trim();
    if (!name) return;
    const ok = await act(
      "/api/collab/me/follows",
      { method: "POST", body: JSON.stringify({ username: name }) },
      `Following ${name}`
    );
    if (ok) setFollowName("");
  }

  useEffect(() => {
    load();
  }, [load]);

  const saveUsername = () =>
    act(
      "/api/collab/me/profile",
      { method: "POST", body: JSON.stringify({ username }) },
      "Username updated"
    );

  if (!loaded) {
    // Mirrors the real panel: five cards, the first carrying the avatar row.
    return <SkeletonPanel cards={5} avatar />;
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          <a href="/auth/sign-in?next=/account" className="text-blue-600 dark:text-blue-400">
            Sign in
          </a>{" "}
          to manage your account.
        </p>
      </div>
    );
  }

  // The trigger on `profiles` is what refuses an early rename; this only decides
  // whether to offer the control and what to say next to it.
  const changeableAt = profile.usernameChangeableAt
    ? new Date(profile.usernameChangeableAt)
    : null;
  const locked = !!changeableAt && changeableAt.getTime() > Date.now();

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <PanelHeader
        title="Account"
        subtitle="Your profile, and who you follow."
        onClose={onClose}
        className="mb-8"
      />

      <Section title="Profile" index={0}>
        <AvatarField
          avatarUrl={profile.avatarUrl}
          username={profile.username}
          busy={busy}
          onUpload={(file) => {
            const body = new FormData();
            body.append("file", file);
            return act("/api/collab/me/avatar", { method: "POST", body }, "Photo updated");
          }}
          onRemove={() =>
            act("/api/collab/me/avatar", { method: "DELETE" }, "Photo removed")
          }
        />

        <label className="mb-1.5 block">
          <span className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
            Username
          </span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={locked}
            className="ui-field ui-field-sm"
          />
        </label>
        <p className="mb-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {locked ? (
            <>
              Changed recently — you can change it again on{" "}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {changeableAt!.toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
              .
            </>
          ) : (
            <>
              Changeable once every {profile.usernameCooldownDays} days. Lowercase letters,
              numbers, underscore or hyphen; at least 3 characters.
            </>
          )}
        </p>
        <button
          onClick={saveUsername}
          disabled={busy || locked || !username.trim() || username.trim() === profile.username}
          className="ui-btn ui-btn-sm ui-btn-primary"
        >
          Save
        </button>
      </Section>

      <Section title="Email and password" index={1}>
        <p className="mb-1 text-sm text-gray-800 dark:text-gray-200">{profile.email}</p>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          Changing your password sends a code to this address.
        </p>
        <a href="/auth/reset?next=/account" className="ui-btn ui-btn-sm ui-btn-secondary">
          Change password
        </a>
      </Section>

      <Section title="Following" index={2}>
        <p className="mb-4 max-w-prose text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          Following someone puts the public folders they publish in your Home feed
          and lets them invite you to folders, once they accept. Answer requests
          you receive in Notifications.
        </p>
        <div className="mb-4 flex gap-2">
          <input
            value={followName}
            onChange={(e) => setFollowName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doFollow()}
            placeholder="username"
            className="ui-field ui-field-sm min-w-0 flex-1"
          />
          <button
            onClick={doFollow}
            disabled={busy || !followName.trim()}
            className="ui-btn ui-btn-sm ui-btn-primary shrink-0"
          >
            Follow
          </button>
        </div>
        {onOpenPeople ? (
          <button onClick={onOpenPeople} className="ui-btn ui-btn-sm ui-btn-secondary">
            Search people you follow
          </button>
        ) : (
          <a href="/people" className="ui-btn ui-btn-sm ui-btn-secondary inline-flex">
            Search people you follow
          </a>
        )}
      </Section>

      <Section title="Connected accounts" index={3}>
        <p className="ui-empty">
          Not available yet — this account signs in with email and password only.
        </p>
      </Section>

      <Section title="Notifications" index={4}>
        <p className="ui-empty">
          Follow requests and folder invitations collect in Notifications,
          reachable from the sidebar whether or not anything is waiting. Accepting
          an invitation is what adds its folder, so nothing there takes effect
          until you answer it.
        </p>
      </Section>
    </div>
  );
}

/**
 * The profile photo: a round preview that reveals a "Change" overlay on hover,
 * a hidden file input behind it, and removal behind ConfirmModal like every
 * other destructive action.
 *
 * The type and size checks here only spare the user a round trip — the route
 * repeats them, and the Storage policies are what actually confine an upload to
 * the uploader's own prefix.
 */
function AvatarField({
  avatarUrl,
  username,
  busy,
  onUpload,
  onRemove,
}: {
  avatarUrl: string | null;
  username: string | null;
  busy: boolean;
  onUpload: (file: File) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [uploading, setUploading] = useState(false);
  const toast = useToast();

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!AVATAR_ACCEPT.split(",").includes(file.type)) {
      toast.error("Use a JPEG, PNG or WebP image.");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error(`Keep the image under ${AVATAR_MAX_BYTES / (1024 * 1024)} MB.`);
      return;
    }
    setUploading(true);
    try {
      await onUpload(file);
    } finally {
      setUploading(false);
      // Clear the input so re-picking the same file fires `change` again.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="mb-6 flex items-center gap-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy || uploading}
        aria-label="Change profile photo"
        className="ui-focus group relative h-20 w-20 shrink-0 overflow-hidden rounded-full border border-black/10 bg-black/[0.03] transition-transform duration-150 ease-out hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.04]"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed
          // Storage URL is short-lived and per-request, so next/image's
          // optimiser has nothing stable to cache.
          <img
            src={avatarUrl}
            alt={username ? `${username}'s profile photo` : "Profile photo"}
            className="ui-rise h-full w-full object-cover"
          />
        ) : (
          <UserIcon className="absolute inset-0 m-auto h-9 w-9 text-gray-400 dark:text-gray-500" />
        )}
        <span className="absolute inset-0 flex items-end justify-center bg-black/55 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-white opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-visible:opacity-100">
          {uploading ? "…" : "Change"}
        </span>
      </button>

      <div className="min-w-0">
        <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
          Profile photo
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy || uploading}
            className="ui-btn ui-btn-xs ui-btn-secondary font-normal"
          >
            {avatarUrl ? "Replace" : "Upload"}
          </button>
          {avatarUrl && (
            <button
              onClick={() => setConfirming(true)}
              disabled={busy || uploading}
              className="ui-btn ui-btn-xs font-normal text-gray-500 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
            >
              Remove
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          JPEG, PNG or WebP, up to {AVATAR_MAX_BYTES / (1024 * 1024)} MB.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ACCEPT}
        onChange={(e) => pick(e.target.files?.[0])}
        className="hidden"
      />

      {confirming && (
        <ConfirmModal
          title="Remove profile photo"
          message="Your photo will be deleted and the placeholder shown instead."
          confirmLabel="Remove"
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false);
            await onRemove();
          }}
        />
      )}
    </div>
  );
}


/** A settings card. `index` staggers its entrance so the page assembles. */
function Section({
  title,
  index,
  children,
}: {
  title: string;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
      className="ui-rise mb-4 rounded-lg border border-black/10 bg-black/[0.01] p-5 transition-colors duration-150 ease-out hover:border-black/20 dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-white/20"
    >
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </h2>
      {children}
    </section>
  );
}
