"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TagChip from "@/components/collab/TagChip";
import UserIcon from "@/components/icons/UserIcon";
import ConfirmModal from "@/components/modals/ConfirmModal";
import { SkeletonPanel } from "@/components/layout/Skeleton";
import { useToast } from "@/components/toast/ToastProvider";
import { AVATAR_ACCEPT, AVATAR_MAX_BYTES } from "@/lib/collab/avatar";
import type { FollowEdge, GrantedTag, UserTag } from "@/lib/collab/types";

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

export default function AccountPanel({ onClose }: { onClose?: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tags, setTags] = useState<UserTag[]>([]);
  const [username, setUsername] = useState("");
  // Follow lists fetch their own page; bumping this makes them re-read after a
  // follow or unfollow.
  const [followRevision, setFollowRevision] = useState(0);
  const [grantCandidates, setGrantCandidates] = useState<FollowEdge[]>([]);
  const [grantQuery, setGrantQuery] = useState("");
  const [followName, setFollowName] = useState("");
  const [grantTo, setGrantTo] = useState("");
  const [grantTag, setGrantTag] = useState("");
  const [given, setGiven] = useState<GrantedTag[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [pRes, tRes, gRes] = await Promise.all([
        fetch("/api/collab/me/profile"),
        fetch("/api/collab/me/tags"),
        fetch("/api/collab/me/grants"),
      ]);
      if (pRes.ok) {
        const { profile } = await pRes.json();
        setProfile(profile);
        setUsername(profile.username ?? "");
      }
      if (tRes.ok) setTags((await tRes.json()).tags ?? []);
      if (gRes.ok) setGiven((await gRes.json()).given ?? []);
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

  const doUnfollow = (userId: string, direction: "following" | "followers") =>
    act(
      `/api/collab/me/follows?userId=${encodeURIComponent(userId)}&direction=${direction}`,
      { method: "DELETE" },
      direction === "following" ? "Unfollowed" : "Follower removed"
    );

  const doRevoke = (username: string, slug: string) =>
    act(
      `/api/collab/me/grants?username=${encodeURIComponent(username)}&tag=${encodeURIComponent(slug)}`,
      { method: "DELETE" },
      `Revoked — folders it opened are closed to ${username}`
    );

  async function doGrant() {
    const ok = await act(
      "/api/collab/me/grants",
      { method: "POST", body: JSON.stringify({ username: grantTo, tag: grantTag.trim() }) },
      `Offered "${grantTag.trim()}" to ${grantTo}`
    );
    if (ok) setGrantTag("");
  }

  useEffect(() => {
    load();
  }, [load]);

  // The tag picker offers a page of followers, searchable — the same rule the
  // lists below follow: never fetch an unbounded people list.
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams({ direction: "followers", limit: String(PAGE) });
      if (grantQuery.trim()) params.set("q", grantQuery.trim());
      fetch(`/api/collab/me/follows?${params}`)
        .then((r) => (r.ok ? r.json() : { people: [] }))
        .then((d) => setGrantCandidates(d.people ?? []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [grantQuery, followRevision]);

  const saveUsername = () =>
    act(
      "/api/collab/me/profile",
      { method: "POST", body: JSON.stringify({ username }) },
      "Username updated"
    );

  const removeTag = (slug: string) =>
    act(
      `/api/collab/me/tags?tag=${encodeURIComponent(slug)}`,
      { method: "DELETE" },
      "Tag removed — folders it shared are no longer readable"
    );

  if (!loaded) {
    // Mirrors the real panel: seven cards, the first carrying the avatar row.
    return <SkeletonPanel cards={7} avatar />;
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
      <div className="mb-8 flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Account
        </h1>
        {onClose ? (
          <button
            onClick={onClose}
            className="ui-btn ui-btn-sm ui-btn-ghost shrink-0 font-normal text-blue-600 dark:text-blue-400"
          >
            Back to notes
          </button>
        ) : (
          <a
            href="/vault"
            className="ui-focus shrink-0 rounded text-sm text-blue-600 transition-colors duration-150 ease-out hover:text-blue-500 dark:text-blue-400"
          >
            Back to folders
          </a>
        )}
      </div>

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

      <Section title="My tags" index={2}>
        <p className="mb-4 max-w-prose text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          Tags are given to you by people you follow — you cannot add your own. Every
          folder carrying a tag you hold is readable by you, so removing a tag gives up
          that access everywhere at once.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {tags.length === 0 && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              No tags yet. Follow someone and they can offer you one.
            </span>
          )}
          {tags.map((tag) => (
            <TagChip key={tag.slug} label={tag.label} onRemove={() => removeTag(tag.slug)} />
          ))}
        </div>
      </Section>

      <Section title="Following" index={3}>
        <p className="mb-4 max-w-prose text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          Following someone lets them offer you tags and invite you to folders. It is
          one-sided and needs no approval.
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
        <PeopleList
          label="You follow"
          direction="following"
          revision={followRevision}
          emptyText="Not following anyone."
          actionLabel="Unfollow"
          onAction={(id) => doUnfollow(id, "following")}
        />
        <PeopleList
          label="Follows you"
          direction="followers"
          revision={followRevision}
          emptyText="No followers yet."
          actionLabel="Remove"
          onAction={(id) => doUnfollow(id, "followers")}
        />
      </Section>

      <Section title="Give a tag" index={4}>
        <p className="mb-4 max-w-prose text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          You can offer a tag to anyone who follows you. They decide whether to accept,
          and accepting shares every folder you tag that way with them.
        </p>
        <input
          value={grantQuery}
          onChange={(e) => setGrantQuery(e.target.value)}
          placeholder="Search your followers"
          className="ui-field ui-field-sm mb-2"
        />
        {grantCandidates.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {grantQuery.trim()
              ? "No follower matches."
              : "Nobody follows you yet, so there is no one to tag."}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <select
              value={grantTo}
              onChange={(e) => setGrantTo(e.target.value)}
              className="ui-field ui-field-sm min-w-0 flex-1"
            >
              <option value="">Choose a follower...</option>
              {grantCandidates.map((f) => (
                <option key={f.userId} value={f.username}>
                  {f.username}
                </option>
              ))}
            </select>
            <input
              value={grantTag}
              onChange={(e) => setGrantTag(e.target.value)}
              placeholder="e.g. ISNE3RD"
              className="ui-field ui-field-sm min-w-0 flex-1"
            />
            <button
              onClick={doGrant}
              disabled={busy || !grantTo || grantTag.trim().length < 2}
              className="ui-btn ui-btn-sm ui-btn-primary shrink-0"
            >
              Offer
            </button>
          </div>
        )}

        {given.length > 0 && (
          <div className="mt-5">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Tags you gave ({given.length})
            </p>
            <ul className="-mx-1.5">
              {given.map((g, i) => (
                <li
                  key={`${g.username}:${g.slug}`}
                  style={{ animationDelay: `${Math.min(i, 6) * 25}ms` }}
                  className="ui-rise ui-row group flex items-center justify-between gap-2 px-1.5 py-1"
                >
                  <span className="min-w-0 truncate text-sm text-gray-700 dark:text-gray-200">
                    {g.username} — {g.label || g.slug}
                  </span>
                  <button
                    onClick={() => doRevoke(g.username, g.slug)}
                    className="ui-btn ui-btn-xs ui-reveal shrink-0 font-normal text-gray-500 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Connected accounts" index={5}>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Not available yet — this account signs in with email and password only.
        </p>
      </Section>

      <Section title="Notifications" index={6}>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Not available yet. Invitations and folder suggestions appear in the sidebar.
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

/**
 * One side of the follow graph, a page at a time. It owns its own query and
 * offset so a long list never arrives in one response, and re-reads whenever
 * `revision` changes (i.e. after a follow or unfollow elsewhere on the page).
 */
function PeopleList({
  label,
  direction,
  revision,
  emptyText,
  actionLabel,
  onAction,
}: {
  label: string;
  direction: "following" | "followers";
  revision: number;
  emptyText: string;
  actionLabel: string;
  onAction: (userId: string) => void;
}) {
  const [people, setPeople] = useState<FollowEdge[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams({
        direction,
        limit: String(PAGE),
        offset: String(offset),
      });
      if (query.trim()) params.set("q", query.trim());
      fetch(`/api/collab/me/follows?${params}`)
        .then((r) => (r.ok ? r.json() : { people: [], total: 0 }))
        .then((d) => {
          setPeople(d.people ?? []);
          setTotal(d.total ?? 0);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [direction, query, offset, revision]);

  return (
    <div className="mt-5">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label} ({total})
      </p>
      {total > PAGE && (
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
          placeholder="Search by username"
          className="ui-field ui-field-sm mb-2"
        />
      )}
      {people.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {query.trim() ? "Nobody matches." : emptyText}
        </p>
      ) : (
        <ul className="-mx-1.5">
          {people.map((p, i) => (
            <li
              key={p.userId}
              style={{ animationDelay: `${Math.min(i, 6) * 25}ms` }}
              className="ui-rise ui-row group flex items-center justify-between gap-2 px-1.5 py-1"
            >
              <span className="truncate text-sm text-gray-700 dark:text-gray-200">
                {p.username}
              </span>
              <button
                onClick={() => onAction(p.userId)}
                className="ui-btn ui-btn-xs ui-reveal shrink-0 font-normal text-gray-500 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
              >
                {actionLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
      {total > PAGE && (
        <div className="mt-3 flex items-center gap-2 text-xs tabular-nums text-gray-500 dark:text-gray-400">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE))}
            className="ui-btn ui-btn-xs ui-btn-secondary font-normal"
          >
            Previous
          </button>
          <span>
            {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
          </span>
          <button
            disabled={offset + PAGE >= total}
            onClick={() => setOffset(offset + PAGE)}
            className="ui-btn ui-btn-xs ui-btn-secondary font-normal"
          >
            Next
          </button>
        </div>
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
