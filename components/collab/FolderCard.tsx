"use client";

import { useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import Avatar from "./Avatar";
import RoleBadge from "./RoleBadge";
import TagChip from "./TagChip";
import type { FolderSummary } from "@/lib/collab/types";

// A discovery result. There is one way in — ask the owner — so the button says
// so; the server still decides what actually happens and the toast reports it.
export default function FolderCard({
  folder,
  onJoined,
}: {
  folder: FolderSummary;
  onJoined?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // One way in from here: ask the owner. Topics are labels, not access.
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

  return (
    <div className="ui-card ui-card-hover flex flex-col bg-white p-4 dark:bg-[#161b22]">
      <div className="mb-1 flex items-start gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          {folder.name}
        </h3>
        <RoleBadge role={folder.myRole} />
      </div>

      <p className="mb-3 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Avatar username={folder.ownerUsername} avatarUrl={folder.ownerAvatar} size={5} />
        by {folder.ownerUsername} · <span data-numeric>{folder.documentCount}</span> notes ·{" "}
        <span data-numeric>{folder.memberCount}</span> members
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
            <TagChip key={t} label={`#${t}`} />
          ))}
        </div>
      )}

      {folder.myRole ? (
        <a
          href={`/vault?folder=${encodeURIComponent(folder.slug)}`}
          className="ui-btn ui-btn-xs ui-btn-primary mt-auto self-start"
        >
          Open
        </a>
      ) : (
        <button
          onClick={join}
          disabled={busy}
          className="ui-btn ui-btn-xs ui-btn-primary mt-auto self-start"
        >
          {busy ? "Working..." : "Request to join"}
        </button>
      )}
    </div>
  );
}
