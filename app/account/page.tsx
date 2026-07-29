"use client";

import { useCallback, useEffect, useState } from "react";
import TagChip from "@/components/collab/TagChip";
import { useToast } from "@/components/toast/ToastProvider";
import type { FollowEdge, GrantedTag, UserTag } from "@/lib/collab/types";

// Account settings. Profile and tags are editable here; email and password
// are not — those go through the existing /auth flow, which already enforces
// the emailed-code second factor. Reimplementing them here would be a second,
// weaker path to the same credential.

// People lists are fetched a page at a time, never whole — same rule as the
// folder console.
const PAGE = 10;

interface Profile {
  username: string | null;
  email: string | null;
  avatarUrl: string | null;
  createdAt: string | null;
}

export default function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tags, setTags] = useState<UserTag[]>([]);
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
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
        setAvatarUrl(profile.avatarUrl ?? "");
      }
      if (tRes.ok) setTags((await tRes.json()).tags ?? []);
      if (gRes.ok) setGiven((await gRes.json()).given ?? []);
      setFollowRevision((n) => n + 1);
    } finally {
      setLoaded(true);
    }
  }, []);

  /** Every mutation here follows the same shape: call, toast, reload. */
  async function act(path: string, init: RequestInit, okMessage: string) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        headers: { "Content-Type": "application/json" },
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
  }

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

  const saveProfile = () =>
    act(
      "/api/collab/me/profile",
      { method: "POST", body: JSON.stringify({ username, avatarUrl }) },
      "Profile updated"
    );

  const removeTag = (slug: string) =>
    act(
      `/api/collab/me/tags?tag=${encodeURIComponent(slug)}`,
      { method: "DELETE" },
      "Tag removed — folders it shared are no longer readable"
    );

  if (!loaded) {
    return <p className="p-6 text-sm text-gray-500">Loading...</p>;
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

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Account</h1>
        <a
          href="/vault"
          className="shrink-0 text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
        >
          Back to folders
        </a>
      </div>

      <Section title="Profile">
        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded border border-black/10 bg-white px-2 py-1.5 text-sm text-gray-800 outline-none dark:border-white/10 dark:bg-white/5 dark:text-gray-200"
          />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Avatar URL</span>
          <input
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://..."
            className="w-full rounded border border-black/10 bg-white px-2 py-1.5 text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:border-white/10 dark:bg-white/5 dark:text-gray-200"
          />
        </label>
        <button
          onClick={saveProfile}
          disabled={busy}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Save
        </button>
      </Section>

      <Section title="Email and password">
        <p className="mb-2 text-sm text-gray-700 dark:text-gray-300">{profile.email}</p>
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
          Changing your password sends a code to this address.
        </p>
        <a
          href="/auth/reset?next=/account"
          className="inline-block rounded border border-black/10 px-3 py-1.5 text-sm text-gray-700 hover:bg-black/5 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5"
        >
          Change password
        </a>
      </Section>

      <Section title="My tags">
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
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

      <Section title="Following">
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
          Following someone lets them offer you tags and invite you to folders. It is
          one-sided and needs no approval.
        </p>
        <div className="mb-3 flex gap-2">
          <input
            value={followName}
            onChange={(e) => setFollowName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doFollow()}
            placeholder="username"
            className="flex-1 rounded border border-black/10 bg-white px-2 py-1.5 text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:border-white/10 dark:bg-white/5 dark:text-gray-200"
          />
          <button
            onClick={doFollow}
            disabled={busy || !followName.trim()}
            className="shrink-0 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
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

      <Section title="Give a tag">
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
          You can offer a tag to anyone who follows you. They decide whether to accept,
          and accepting shares every folder you tag that way with them.
        </p>
        <input
          value={grantQuery}
          onChange={(e) => setGrantQuery(e.target.value)}
          placeholder="Search your followers"
          className="mb-2 w-full rounded border border-black/10 bg-white px-2 py-1.5 text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:border-white/10 dark:bg-white/5 dark:text-gray-200"
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
              className="min-w-0 flex-1 rounded border border-black/10 bg-white px-2 py-1.5 text-sm text-gray-800 outline-none dark:border-white/10 dark:bg-white/5 dark:text-gray-200"
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
              className="min-w-0 flex-1 rounded border border-black/10 bg-white px-2 py-1.5 text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:border-white/10 dark:bg-white/5 dark:text-gray-200"
            />
            <button
              onClick={doGrant}
              disabled={busy || !grantTo || grantTag.trim().length < 2}
              className="shrink-0 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              Offer
            </button>
          </div>
        )}

        {given.length > 0 && (
          <div className="mt-4">
            <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
              Tags you gave ({given.length})
            </p>
            <ul>
              {given.map((g) => (
                <li
                  key={`${g.username}:${g.slug}`}
                  className="group flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="min-w-0 truncate text-sm text-gray-700 dark:text-gray-200">
                    {g.username} — {g.label || g.slug}
                  </span>
                  <button
                    onClick={() => doRevoke(g.username, g.slug)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs text-gray-500 opacity-0 hover:bg-red-500/10 hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Connected accounts">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Not available yet — this account signs in with email and password only.
        </p>
      </Section>

      <Section title="Notifications">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Not available yet. Invitations and folder suggestions appear in the sidebar.
        </p>
      </Section>
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
    <div className="mt-3">
      <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
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
          className="mb-2 w-full rounded border border-black/10 bg-white px-2 py-1 text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:border-white/10 dark:bg-white/5 dark:text-gray-200"
        />
      )}
      {people.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {query.trim() ? "Nobody matches." : emptyText}
        </p>
      ) : (
        <ul>
          {people.map((p) => (
            <li
              key={p.userId}
              className="group flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-black/5 dark:hover:bg-white/5"
            >
              <span className="truncate text-sm text-gray-700 dark:text-gray-200">
                {p.username}
              </span>
              <button
                onClick={() => onAction(p.userId)}
                className="shrink-0 rounded px-1.5 py-0.5 text-xs text-gray-500 opacity-0 hover:bg-red-500/10 hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
              >
                {actionLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
      {total > PAGE && (
        <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE))}
            className="rounded border border-black/10 px-2 py-0.5 hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
          >
            Previous
          </button>
          <span>
            {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
          </span>
          <button
            disabled={offset + PAGE >= total}
            onClick={() => setOffset(offset + PAGE)}
            className="rounded border border-black/10 px-2 py-0.5 hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded border border-black/10 p-4 dark:border-white/10">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </h2>
      {children}
    </section>
  );
}
