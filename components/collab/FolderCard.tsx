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
    <div className="flex min-w-0 flex-col p-5 transition-colors duration-150 ease-out hover:bg-accent/[0.03]">
      <div className="mb-1 flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words text-base font-semibold leading-snug tracking-tight text-ink">{folder.name}</h3>
        {folder.myRole ? (
          <RoleBadge role={folder.myRole} />
        ) : (
          folder.visibility === "private" && <span className="ui-badge text-muted">Private</span>
        )}
      </div>

      <p className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
        <Avatar username={folder.ownerUsername} avatarUrl={folder.ownerAvatar} size={5} />
        <span className="truncate">{folder.ownerUsername}</span>
        <span aria-hidden>·</span>
        <span data-numeric className="shrink-0">
          {folder.documentCount} notes
        </span>
      </p>

      {folder.description && <p className="mt-3 line-clamp-2 text-sm text-ink-2">{folder.description}</p>}

      {folder.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {folder.tags.map((t) => (
            <TagChip key={t} label={`#${t}`} />
          ))}
        </div>
      )}

      <div className="mt-auto pt-4">
        {folder.myRole ? (
          <a href={`/vault?folder=${encodeURIComponent(folder.slug)}`} className="ui-btn ui-btn-sm ui-btn-text -ml-1">
            Open
          </a>
        ) : (
          <button onClick={join} disabled={busy} className="ui-btn ui-btn-sm ui-btn-text -ml-1">
            {busy ? "Sending…" : "Request to join"}
          </button>
        )}
      </div>
    </div>
  );
}
