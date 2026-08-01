"use client";

import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/collab/Avatar";
import SearchIcon from "@/components/icons/SearchIcon";
import { SkeletonRows } from "@/components/layout/Skeleton";
import { useToast } from "@/components/toast/ToastProvider";
import type { FollowEdge } from "@/lib/collab/types";

const PAGE = 10;

// Search over your own network — who you follow and who follows you. Not a
// directory of every user on the platform: `profiles` has no broad SELECT
// policy (see docs/collaboration.md), and this only ever reads follow edges
// RLS already scopes to the caller. A search box, not a browse-all list: an
// empty query shows nothing, same rule as DiscoverPanel and the notes search.
//
// Rendered in two places from one definition, like DiscoverPanel: inside the
// workspace's content column (AppShell, with `onClose`) and as the standalone
// /people page a deep link lands on.
export default function PeoplePanel({ onClose }: { onClose?: () => void }) {
  const [direction, setDirection] = useState<"following" | "followers">("following");
  const [followName, setFollowName] = useState("");
  const [busy, setBusy] = useState(false);
  // Bumped after a follow, so the active tab's list re-checks itself against
  // the graph (mainly relevant if the caller follows someone already listed).
  const [revision, setRevision] = useState(0);
  // A session that expired after the panel opened — middleware already
  // redirects a signed-out visit here, so this only fires on a stale client.
  const [needsAuth, setNeedsAuth] = useState(false);
  const toast = useToast();

  async function doFollow() {
    const name = followName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/collab/me/follows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "failed");
      toast.success(`Follow request sent to ${name}`);
      setFollowName("");
      setRevision((n) => n + 1);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-8">
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          People
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
            Back to vault
          </a>
        )}
      </div>

      {needsAuth ? (
        <div className="py-16 text-center">
          <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
            Your session expired — sign in again to search your network.
          </p>
          <a href="/auth/sign-in?next=/people" className="ui-btn ui-btn-primary px-4">
            Sign in
          </a>
        </div>
      ) : (
        <>
          <p className="mb-4 max-w-prose text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            Following someone lets them offer you tags and invite you to folders —
            once they accept. Requests you receive appear at the top of the sidebar.
          </p>

          <div className="mb-6 flex gap-2">
            <input
              value={followName}
              onChange={(e) => setFollowName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doFollow()}
              placeholder="Follow by exact username"
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

          <div className="mb-4 flex gap-1 border-b border-black/10 dark:border-white/10">
            {(["following", "followers"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className={`ui-focus -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150 ease-out ${
                  direction === d
                    ? "border-blue-600 text-blue-700 dark:border-blue-500 dark:text-blue-300"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                {d === "following" ? "You follow" : "Follows you"}
              </button>
            ))}
          </div>

          <PeopleSearch
            key={direction}
            direction={direction}
            revision={revision}
            onAuthRequired={() => setNeedsAuth(true)}
          />
        </>
      )}
    </div>
  );
}

/**
 * One direction's search. A fresh instance per tab (keyed by `direction` in
 * the parent) rather than an effect reacting to a prop change — simpler than
 * threading a reset through every piece of state below.
 */
function PeopleSearch({
  direction,
  revision,
  onAuthRequired,
}: {
  direction: "following" | "followers";
  revision: number;
  onAuthRequired: () => void;
}) {
  const toast = useToast();
  const [q, setQ] = useState("");
  // "" means "never searched" as well as "just cleared" — both show nothing.
  const [submitted, setSubmitted] = useState("");
  const [offset, setOffset] = useState(0);
  const [people, setPeople] = useState<FollowEdge[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  // Distinct from "no results": a failed request must not read as "nobody
  // matches" — same rule DiscoverPanel follows for its own search.
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    async (term: string, off: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          direction,
          q: term,
          limit: String(PAGE),
          offset: String(off),
        });
        const res = await fetch(`/api/collab/me/follows?${params}`);
        if (res.status === 401) {
          onAuthRequired();
          return;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "search failed");
        }
        const data = await res.json();
        setPeople(data.people ?? []);
        setTotal(data.total ?? 0);
      } catch (err: any) {
        setError(err.message);
        setPeople([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [direction, onAuthRequired]
  );

  // A follow elsewhere in the panel doesn't change an already-submitted
  // result set, so this only needs to re-run the current page.
  useEffect(() => {
    if (submitted) load(submitted, offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  function submit() {
    const term = q.trim();
    setSubmitted(term);
    setOffset(0);
    if (!term) {
      setPeople([]);
      setTotal(0);
      return;
    }
    load(term, 0);
  }

  function clear() {
    setQ("");
    setSubmitted("");
    setOffset(0);
    setPeople([]);
    setTotal(0);
  }

  function goToOffset(next: number) {
    setOffset(next);
    load(submitted, next);
  }

  async function act(userId: string) {
    setBusy(userId);
    try {
      const res = await fetch(
        `/api/collab/me/follows?userId=${encodeURIComponent(userId)}&direction=${direction}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "failed");
      toast.success(direction === "following" ? "Unfollowed" : "Follower removed");
      setPeople((list) => list.filter((p) => p.userId !== userId));
      setTotal((n) => Math.max(0, n - 1));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div className="ui-field flex flex-1 items-center gap-2 px-2.5 py-1.5">
          <SearchIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Search by username — press Enter"
            className="w-full bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:text-gray-200 dark:placeholder:text-gray-500"
          />
          {submitted && (
            <button onClick={clear} title="Clear search" className="ui-icon-btn h-5 w-5 text-xs">
              ✕
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <SkeletonRows rows={4} lines={1} />
      ) : error ? (
        <p className="py-8 text-center text-sm text-red-600 dark:text-red-400">
          Search failed — {error}
        </p>
      ) : !submitted ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          {direction === "following"
            ? "Search who you follow by username."
            : "Search who follows you by username."}
        </p>
      ) : people.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          Nobody matches &quot;{submitted}&quot;.
        </p>
      ) : (
        <ul className="-mx-1.5">
          {people.map((p, i) => (
            <li
              key={p.userId}
              style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}
              className="ui-rise ui-row group flex items-center gap-2.5 px-1.5 py-1.5"
            >
              <Avatar username={p.username} avatarUrl={p.avatarUrl} size={6} />
              <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-200">
                {p.username}
              </span>
              <button
                onClick={() => act(p.userId)}
                disabled={busy === p.userId}
                className="ui-btn ui-btn-xs ui-reveal shrink-0 font-normal text-gray-500 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
              >
                {direction === "following" ? "Unfollow" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {total > PAGE && (
        <div className="mt-3 flex items-center gap-2 text-xs tabular-nums text-gray-500 dark:text-gray-400">
          <button
            disabled={offset === 0}
            onClick={() => goToOffset(Math.max(0, offset - PAGE))}
            className="ui-btn ui-btn-xs ui-btn-secondary font-normal"
          >
            Previous
          </button>
          <span>
            {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
          </span>
          <button
            disabled={offset + PAGE >= total}
            onClick={() => goToOffset(offset + PAGE)}
            className="ui-btn ui-btn-xs ui-btn-secondary font-normal"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
