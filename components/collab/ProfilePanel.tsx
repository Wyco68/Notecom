"use client";

import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/collab/Avatar";
import FolderCard from "@/components/collab/FolderCard";
import PanelHeader from "@/components/layout/PanelHeader";
import { SkeletonCard, SkeletonPanel } from "@/components/layout/Skeleton";
import { useToast } from "@/components/toast/ToastProvider";
import type { FolderSummary, Profile } from "@/lib/collab/types";

// One person: who they are, how connected, and the folders of theirs the
// reader can see. Following still asks — the button says "Requested" until
// they answer — and joining a folder still goes through its owner, via the
// same FolderCard Discover uses.
//
// Rendered in the workspace's content column (AppShell, with `onClose`) and as
// the standalone /u/[username] page a shared link lands on.

export default function ProfilePanel({
  username,
  onClose,
  onJoined,
}: {
  username: string;
  onClose?: () => void;
  onJoined?: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [folders, setFolders] = useState<FolderSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const base = `/api/collab/users/${encodeURIComponent(username)}`;

  const load = useCallback(async () => {
    const [pRes, fRes] = await Promise.all([fetch(base), fetch(`${base}/folders`)]);
    setProfile(pRes.ok ? (await pRes.json()).profile : null);
    setFolders(fRes.ok ? ((await fRes.json()).folders ?? []) : []);
  }, [base]);

  useEffect(() => {
    load().catch(() => setProfile(null));
  }, [load]);

  async function toggleFollow() {
    if (!profile) return;
    setBusy(true);
    try {
      const unfollow = profile.followState !== "none";
      const res = unfollow
        ? await fetch(
            `/api/collab/me/follows?userId=${encodeURIComponent(profile.userId)}&direction=following`,
            { method: "DELETE" }
          )
        : await fetch("/api/collab/me/follows", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: profile.username }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "failed");
      toast.success(
        unfollow
          ? profile.followState === "pending"
            ? "Follow request withdrawn"
            : `Unfollowed ${profile.username}`
          : `Follow request sent to ${profile.username}`
      );
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (profile === undefined) return <SkeletonPanel cards={2} avatar />;

  if (profile === null) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-8">
        <PanelHeader title="Not found" onClose={onClose} />
        <p className="ui-empty">There is no one called {username}.</p>
      </div>
    );
  }

  const followLabel = {
    none: "Follow",
    pending: "Requested",
    accepted: "Following",
    self: null,
  }[profile.followState];

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <PanelHeader title={profile.username} onClose={onClose} className="mb-6" />

      <div className="mb-8 flex flex-wrap items-center gap-4">
        <Avatar username={profile.username} avatarUrl={profile.avatarUrl} size={10} />
        <dl className="flex min-w-0 flex-1 gap-5 text-sm">
          {(
            [
              ["Followers", profile.followers],
              ["Following", profile.following],
              ["Public folders", profile.publicFolders],
            ] as const
          ).map(([label, n]) => (
            <div key={label}>
              <dd className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{n}</dd>
              <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
            </div>
          ))}
        </dl>
        {followLabel && (
          <button
            onClick={toggleFollow}
            disabled={busy}
            className={`ui-btn ui-btn-sm shrink-0 ${
              profile.followState === "none" ? "ui-btn-primary" : "ui-btn-secondary"
            }`}
          >
            {followLabel}
          </button>
        )}
      </div>

      <h2 className="ui-section-title mb-3">Folders</h2>
      {folders === null ? (
        <SkeletonCard lines={2} />
      ) : folders.length === 0 ? (
        <p className="ui-empty">No folders you can see yet.</p>
      ) : (
        <div className="grid gap-3">
          {folders.map((f) => (
            <FolderCard key={f.id} folder={f} onJoined={onJoined} />
          ))}
        </div>
      )}
    </div>
  );
}
