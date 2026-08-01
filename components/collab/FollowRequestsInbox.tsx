"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import Avatar from "./Avatar";
import type { FollowRequest } from "@/lib/collab/types";

// People who asked to follow the caller. Accepting matters: it's what lets
// the follower be offered a tag or invited to a folder, so this is the
// consent step for that, not a cosmetic "new follower" notice.
//
// Renders nothing when the inbox is empty, like InvitationsInbox and
// TagGrantsInbox — the three stack in the sidebar, each independently silent.
export default function FollowRequestsInbox({ onChanged }: { onChanged?: () => void }) {
  const [requests, setRequests] = useState<FollowRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  async function load() {
    try {
      const res = await fetch("/api/collab/me/follow-requests");
      if (!res.ok) return;
      const data = await res.json();
      setRequests(data.requests ?? []);
    } catch {
      // Collaboration may not be configured on this box; stay quiet.
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function respond(followerId: string, username: string, accept: boolean) {
    setBusy(followerId);
    try {
      const res = await fetch("/api/collab/me/follow-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followerId, accept }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      toast.success(accept ? `Accepted ${username}` : "Declined");
      setRequests((list) => list.filter((r) => r.followerId !== followerId));
      onChanged?.();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (!requests.length) return null;

  return (
    <div className="border-b border-black/10 px-3 py-3 dark:border-white/10">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Follow requests
      </h3>
      <div className="space-y-2">
        {requests.map((r) => (
          <div
            key={r.followerId}
            className="flex items-center gap-2.5 rounded-md border border-black/10 bg-black/[0.02] p-2.5 dark:border-white/10 dark:bg-white/[0.03]"
          >
            <Avatar username={r.username} avatarUrl={r.avatarUrl} />
            <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-gray-100">
              {r.username}
            </span>
            <div className="flex shrink-0 gap-1.5">
              <button
                onClick={() => respond(r.followerId, r.username, true)}
                disabled={busy === r.followerId}
                className="ui-btn ui-btn-xs ui-btn-primary"
              >
                Accept
              </button>
              <button
                onClick={() => respond(r.followerId, r.username, false)}
                disabled={busy === r.followerId}
                className="ui-btn ui-btn-xs ui-btn-secondary"
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
