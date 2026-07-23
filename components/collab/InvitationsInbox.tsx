"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import RoleBadge from "./RoleBadge";
import type { Invitation } from "@/lib/collab/types";

// The caller's pending invitations. Renders nothing at all when the inbox is
// empty — an empty panel in the shell would be noise on every page load.
export default function InvitationsInbox({ onChanged }: { onChanged?: () => void }) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  async function load() {
    try {
      const res = await fetch("/api/collab/invitations");
      if (!res.ok) return;
      const data = await res.json();
      setInvitations(data.invitations ?? []);
    } catch {
      // Collaboration may not be configured on this box; stay quiet.
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function respond(id: string, accept: boolean) {
    setBusy(id);
    try {
      const res = await fetch("/api/collab/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitationId: id, accept }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      toast.success(accept ? "Invitation accepted" : "Invitation declined");
      setInvitations((list) => list.filter((i) => i.id !== id));
      onChanged?.();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (!invitations.length) return null;

  return (
    <div className="border-b border-black/10 px-3 py-3 dark:border-white/10">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Invitations
      </h3>
      <div className="space-y-2">
        {invitations.map((inv) => (
          <div
            key={inv.id}
            className="rounded border border-black/10 bg-black/[0.02] p-2 dark:border-white/10 dark:bg-white/[0.03]"
          >
            <div className="mb-1.5 flex items-center gap-2">
              <span className="truncate text-sm text-gray-900 dark:text-gray-100">
                {inv.folderName}
              </span>
              <RoleBadge role={inv.role} />
            </div>
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              from {inv.inviterUsername}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => respond(inv.id, true)}
                disabled={busy === inv.id}
                className="flex-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                Accept
              </button>
              <button
                onClick={() => respond(inv.id, false)}
                disabled={busy === inv.id}
                className="flex-1 rounded border border-black/10 px-2 py-1 text-xs text-gray-600 hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
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
