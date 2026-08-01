"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import Avatar from "./Avatar";
import TagChip from "./TagChip";
import type { TagGrant } from "@/lib/collab/types";

// Tags people you follow have offered you.
//
// Accepting matters: holding a tag grants read access to every folder carrying
// it, so this is the consent step for that access — not a cosmetic label. The
// copy says so, because "accept a tag" otherwise reads as harmless.
//
// Renders nothing when the inbox is empty, like InvitationsInbox.
export default function TagGrantsInbox({ onChanged }: { onChanged?: () => void }) {
  const [grants, setGrants] = useState<TagGrant[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/collab/me/grants");
      if (!res.ok) return;
      const data = await res.json();
      setGrants(data.grants ?? []);
    } catch {
      // Collaboration may not be configured on this box; stay quiet.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function respond(grant: TagGrant, accept: boolean) {
    setBusy(grant.id);
    try {
      const res = await fetch("/api/collab/me/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantId: grant.id, accept }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      toast.success(accept ? `Accepted "${grant.label}"` : "Declined");
      setGrants((list) => list.filter((g) => g.id !== grant.id));
      onChanged?.();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (!grants.length) return null;

  return (
    <div className="border-b border-black/10 px-3 py-3 dark:border-white/10">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Tag offers
      </h3>
      <div className="space-y-2">
        {grants.map((grant) => (
          <div
            key={grant.id}
            className="rounded-md border border-black/10 bg-black/[0.02] p-2.5 dark:border-white/10 dark:bg-white/[0.03]"
          >
            <div className="mb-1.5 flex items-center gap-2">
              <TagChip label={grant.label || grant.slug} grantsJoin />
            </div>
            <p className="mb-2 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <Avatar username={grant.granterUsername} avatarUrl={grant.granterAvatarUrl} size={5} />
              from {grant.granterUsername} — accepting shares folders tagged this way with
              you
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => respond(grant, true)}
                disabled={busy === grant.id}
                className="ui-btn ui-btn-xs ui-btn-primary flex-1"
              >
                Accept
              </button>
              <button
                onClick={() => respond(grant, false)}
                disabled={busy === grant.id}
                className="ui-btn ui-btn-xs ui-btn-secondary flex-1"
              >
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
