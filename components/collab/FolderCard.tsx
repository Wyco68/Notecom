"use client";

import { useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import RoleBadge from "./RoleBadge";
import TagChip from "./TagChip";
import type { FolderSummary } from "@/lib/collab/types";

// A discovery result. The join affordance is chosen from join_policy, but the
// server decides what actually happens — the button text is a prediction, the
// toast reports the truth.
export default function FolderCard({
  folder,
  onJoined,
}: {
  folder: FolderSummary;
  onJoined?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // Only one path remains: ask the owner. Tags no longer join anything —
  // holding one grants access directly, and it arrives as an offer to accept.
  async function join() {
    setBusy(true);
    try {
      const res = await fetch("/api/collab/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: folder.slug, owner: folder.ownerUsername }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      toast.success(data.status === "joined" ? "Joined folder" : "Request sent to the owner");
      onJoined?.();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const joinable = !folder.myRole && folder.joinPolicy !== "invite_only";

  return (
    <div className="rounded-lg border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-[#161b22]">
      <div className="mb-1 flex items-start gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
          {folder.name}
        </h3>
        <RoleBadge role={folder.myRole} />
      </div>

      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        by {folder.ownerUsername} · {folder.documentCount} notes · {folder.memberCount} members
        {folder.visibility === "private" && " · private"}
      </p>

      {folder.description && (
        <p className="mb-3 line-clamp-2 text-sm text-gray-700 dark:text-gray-300">
          {folder.description}
        </p>
      )}

      {folder.tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {folder.tags.map((t) => (
            <TagChip key={t} label={t} grantsJoin={folder.joinTags.includes(t)} />
          ))}
        </div>
      )}

      {folder.myRole ? (
        <a
          href={`/vault?folder=${encodeURIComponent(folder.slug)}`}
          className="inline-block rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
        >
          Open
        </a>
      ) : joinable ? (
        <button
          onClick={join}
          disabled={busy}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ? "Working..." : folder.joinPolicy === "open" ? "Join" : "Request to join"}
        </button>
      ) : (
        <span className="text-xs text-gray-400">Invite only</span>
      )}
    </div>
  );
}
