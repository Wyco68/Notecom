"use client";

import { use, useCallback, useEffect, useState } from "react";
import ConfirmModal from "@/components/modals/ConfirmModal";
import MemberRow from "@/components/collab/MemberRow";
import TagChip from "@/components/collab/TagChip";
import SpinnerIcon from "@/components/icons/SpinnerIcon";
import { useToast } from "@/components/toast/ToastProvider";
import type {
  FolderDetail,
  FolderRole,
  FolderTag,
  Invitation,
  JoinRequest,
  Member,
} from "@/lib/collab/types";

// Owner console for one folder. Every control here is also enforced in the
// database — a non-owner who loads this page sees the read-only view because
// the server refused, not because the page decided to hide anything.
export default function ManageFolderPage({
  params,
}: {
  params: Promise<{ folder: string }>;
}) {
  const { folder: slug } = use(params);
  const toast = useToast();

  const [detail, setDetail] = useState<FolderDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tags, setTags] = useState<FolderTag[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<FolderRole>("viewer");
  const [tagLabel, setTagLabel] = useState("");
  const [tagGrantsJoin, setTagGrantsJoin] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);

  const base = `/api/collab/folders/${encodeURIComponent(slug)}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(base);
      if (res.status === 401) {
        setNeedsAuth(true);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed to load folder");
      setDetail(data.folder);
      setMembers(data.members ?? []);
      setTags(data.tags ?? []);

      // Manager-only lists: a 403 here is a normal answer for a member.
      const [reqRes, invRes] = await Promise.all([
        fetch(`${base}/requests`),
        fetch(`${base}/invitations`),
      ]);
      setRequests(reqRes.ok ? ((await reqRes.json()).requests ?? []) : []);
      setInvitations(invRes.ok ? ((await invRes.json()).invitations ?? []) : []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  async function send(path: string, init: RequestInit, okMessage: string) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });
      const data = await res.json();
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

  const canManage = detail?.myRole === "owner";

  if (loading) {
    return (
      <main className="flex justify-center py-24 text-gray-400">
        <SpinnerIcon className="h-6 w-6" />
      </main>
    );
  }

  if (needsAuth) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
          Sign in to manage folder sharing.
        </p>
        <a
          href={`/auth/sign-in?next=/vault/${encodeURIComponent(slug)}/manage`}
          className="inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Sign in
        </a>
      </main>
    );
  }

  if (error || !detail) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="text-sm text-red-400">{error ?? "Folder not found."}</p>
        <a href="/vault" className="mt-4 inline-block text-sm text-blue-500 hover:text-blue-400">
          Back to vault
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{detail.name}</h1>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            owned by {detail.ownerUsername} · {detail.documentCount} notes
          </p>
        </div>
        <a href="/vault" className="text-sm text-blue-500 hover:text-blue-400">
          Back to vault
        </a>
      </div>

      {!canManage && (
        <p className="mb-8 rounded border border-black/10 bg-black/[0.02] px-3 py-2 text-xs text-gray-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-400">
          You are a {detail.myRole ?? "guest"} in this folder. Only the owner can change its
          settings.
        </p>
      )}

      {canManage && (
        <Section title="Sharing">
          <div className="space-y-3">
            <Toggle
              label="Public"
              hint="Anyone signed in can read the notes."
              checked={detail.visibility === "public"}
              disabled={busy}
              onChange={(v) =>
                send(
                  `${base}/settings`,
                  { method: "POST", body: JSON.stringify({ visibility: v ? "public" : "private" }) },
                  "Visibility updated"
                )
              }
            />
            <Toggle
              label="Discoverable"
              hint="Appears in search. Turn off to hide the folder entirely."
              checked={detail.discoverable}
              disabled={busy}
              onChange={(v) =>
                send(
                  `${base}/settings`,
                  { method: "POST", body: JSON.stringify({ discoverable: v }) },
                  "Discoverability updated"
                )
              }
            />
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                Join policy
              </label>
              <select
                value={detail.joinPolicy}
                disabled={busy}
                onChange={(e) =>
                  send(
                    `${base}/settings`,
                    { method: "POST", body: JSON.stringify({ joinPolicy: e.target.value }) },
                    "Join policy updated"
                  )
                }
                className="rounded border border-black/10 bg-gray-50 px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
              >
                <option value="open">Anyone can join</option>
                <option value="request">Requires approval</option>
                <option value="invite_only">Invite only</option>
              </select>
            </div>
          </div>
        </Section>
      )}

      <Section title={`Members (${members.length})`}>
        {members.length === 0 ? (
          <Empty>No members yet.</Empty>
        ) : (
          <div className="-mx-2">
            {members.map((m) => (
              <MemberRow
                key={m.userId}
                member={m}
                canManage={!!canManage}
                isSelf={m.userId === detail.ownerId && detail.myRole === "owner"}
                onRoleChange={(role) =>
                  send(
                    `${base}/members`,
                    { method: "POST", body: JSON.stringify({ userId: m.userId, role }) },
                    `${m.username} is now ${role}`
                  )
                }
                onRemove={() => setRemoving(m)}
              />
            ))}
          </div>
        )}
      </Section>

      {canManage && (
        <Section title="Invite someone">
          <div className="flex gap-2">
            <input
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="username"
              className="min-w-0 flex-1 rounded border border-black/10 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as FolderRole)}
              className="rounded border border-black/10 bg-gray-50 px-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
            >
              <option value="viewer">viewer</option>
              <option value="editor">editor</option>
            </select>
            <button
              disabled={busy || !inviteName.trim()}
              onClick={async () => {
                const ok = await send(
                  `${base}/invitations`,
                  {
                    method: "POST",
                    body: JSON.stringify({ username: inviteName.trim(), role: inviteRole }),
                  },
                  `Invited ${inviteName.trim()}`
                );
                if (ok) setInviteName("");
              }}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              Invite
            </button>
          </div>
          {invitations.length > 0 && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Pending: {invitations.map((i) => i.inviteeUsername).join(", ")}
            </p>
          )}
        </Section>
      )}

      {canManage && (
        <Section title={`Join requests (${requests.length})`}>
          {requests.length === 0 ? (
            <Empty>No pending requests.</Empty>
          ) : (
            <div className="space-y-2">
              {requests.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 rounded border border-black/10 px-3 py-2 dark:border-white/10"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-900 dark:text-gray-100">{r.username}</div>
                    {r.message && (
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                        {r.message}
                      </p>
                    )}
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      send(
                        `${base}/requests`,
                        {
                          method: "POST",
                          body: JSON.stringify({ requestId: r.id, approve: true }),
                        },
                        `${r.username} added`
                      )
                    }
                    className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      send(
                        `${base}/requests`,
                        {
                          method: "POST",
                          body: JSON.stringify({ requestId: r.id, approve: false }),
                        },
                        "Request rejected"
                      )
                    }
                    className="rounded border border-black/10 px-2.5 py-1 text-xs text-gray-600 hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
                  >
                    Reject
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      <Section title="Tags">
        {tags.length === 0 ? (
          <Empty>No tags yet.</Empty>
        ) : (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <TagChip
                key={t.slug}
                label={t.label || t.slug}
                grantsJoin={t.grantsJoin}
                onRemove={
                  canManage
                    ? () =>
                        send(
                          `${base}/tags?tag=${encodeURIComponent(t.slug)}`,
                          { method: "DELETE" },
                          "Tag removed"
                        )
                    : undefined
                }
              />
            ))}
          </div>
        )}

        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={tagLabel}
              onChange={(e) => setTagLabel(e.target.value)}
              placeholder="e.g. algorithms"
              className="min-w-0 flex-1 rounded border border-black/10 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
            />
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={tagGrantsJoin}
                onChange={(e) => setTagGrantsJoin(e.target.checked)}
              />
              allows joining
            </label>
            <button
              disabled={busy || tagLabel.trim().length < 2}
              onClick={async () => {
                const ok = await send(
                  `${base}/tags`,
                  {
                    method: "POST",
                    body: JSON.stringify({ tag: tagLabel.trim(), grantsJoin: tagGrantsJoin }),
                  },
                  "Tag added"
                );
                if (ok) {
                  setTagLabel("");
                  setTagGrantsJoin(false);
                }
              }}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        )}
      </Section>

      {removing && (
        <ConfirmModal
          title="Remove member"
          message={`Remove ${removing.username} from ${detail.name}? They lose access to every note in this folder.`}
          confirmLabel="Remove"
          busy={busy}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await send(
              `${base}/members?userId=${encodeURIComponent(removing.userId)}`,
              { method: "DELETE" },
              `${removing.username} removed`
            );
            setRemoving(null);
          }}
        />
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-500 dark:text-gray-400">{children}</p>;
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span>
        <span className="block text-sm text-gray-900 dark:text-gray-100">{label}</span>
        <span className="block text-xs text-gray-500 dark:text-gray-400">{hint}</span>
      </span>
    </label>
  );
}
