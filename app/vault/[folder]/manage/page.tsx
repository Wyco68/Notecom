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
  Visibility,
} from "@/lib/collab/types";

// How many people a list shows at once. Small on purpose: these lists have no
// ceiling, and the search box is the way through a long one.
const PAGE = 10;

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
  const [memberTotal, setMemberTotal] = useState(0);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberOffset, setMemberOffset] = useState(0);
  const [tags, setTags] = useState<FolderTag[]>([]);
  // Folder settings are edited as a draft and written by "Save changes", so a
  // mistyped description or a mis-clicked toggle costs nothing until then.
  const [draft, setDraft] = useState<{ visibility: Visibility; description: string } | null>(null);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  const [inviteName, setInviteName] = useState("");
  // Only followers can be invited (notes_invite_member refuses anyone else), so
  // the field offers exactly them rather than letting the user guess a username
  // and receive a refusal.
  const [followers, setFollowers] = useState<{ userId: string; username: string }[]>([]);
  const [followerQuery, setFollowerQuery] = useState("");
  const [inviteRole, setInviteRole] = useState<FolderRole>("viewer");
  const [tagLabel, setTagLabel] = useState("");
  const [tagGrantsJoin, setTagGrantsJoin] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [transferTo, setTransferTo] = useState("");
  // Both destructive actions route through ConfirmModal, so one bit of state
  // tracks which one is awaiting confirmation.
  const [confirming, setConfirming] = useState<{ kind: "transfer" | "delete" } | null>(null);
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
      setDraft({
        visibility: data.folder.visibility,
        description: data.folder.description ?? "",
      });
      setMembers(data.members ?? []);
      setMemberTotal(data.memberTotal ?? (data.members ?? []).length);
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

  // Members are their own request so paging and searching don't re-fetch the
  // whole console. Debounced, since it runs per keystroke.
  const loadMembers = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(memberOffset) });
    if (memberQuery.trim()) params.set("q", memberQuery.trim());
    const res = await fetch(`${base}/members?${params}`);
    if (!res.ok) return;
    const data = await res.json();
    setMembers(data.members ?? []);
    setMemberTotal(data.total ?? 0);
  }, [base, memberQuery, memberOffset]);

  useEffect(() => {
    const t = setTimeout(loadMembers, 250);
    return () => clearTimeout(t);
  }, [loadMembers]);

  // Only followers can be invited, and only a page of them is fetched — the
  // search box is what reaches the rest.
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams({
        direction: "followers",
        limit: String(PAGE),
      });
      if (followerQuery.trim()) params.set("q", followerQuery.trim());
      fetch(`/api/collab/me/follows?${params}`)
        .then((r) => (r.ok ? r.json() : { people: [] }))
        .then((d) => setFollowers(d.people ?? []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [followerQuery]);

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
      await Promise.all([load(), loadMembers()]);
      return true;
    } catch (err: any) {
      toast.error(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const canManage = detail?.myRole === "owner";
  const settingsDirty =
    !!detail &&
    !!draft &&
    (draft.visibility !== detail.visibility ||
      draft.description.trim() !== (detail.description ?? "").trim());
  // Ownership can only move to an existing member, which is also what the RPC
  // enforces — offering anyone else would just produce a refusal.
  const transferable = members.filter((m) => m.role !== "owner");

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

      {canManage && draft && (
        <Section title="Sharing">
          <div className="space-y-3">
            <Toggle
              label="Public"
              hint="Anyone signed in can find this folder in search. The files inside stay members-only either way, and joining always means asking you."
              checked={draft.visibility === "public"}
              disabled={busy}
              onChange={(v) =>
                setDraft({ ...draft, visibility: v ? "public" : "private" })
              }
            />
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                Description
              </label>
              <textarea
                value={draft.description}
                rows={3}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="What is in this folder?"
                className="w-full rounded border border-black/10 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={busy || !settingsDirty}
                onClick={() =>
                  send(
                    `${base}/settings`,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        visibility: draft.visibility,
                        description: draft.description.trim() || null,
                      }),
                    },
                    "Changes saved"
                  )
                }
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                Save changes
              </button>
              <button
                disabled={busy || !settingsDirty}
                onClick={() =>
                  setDraft({
                    visibility: detail.visibility,
                    description: detail.description ?? "",
                  })
                }
                className="rounded border border-black/10 px-3 py-1.5 text-sm text-gray-600 hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
              >
                Discard
              </button>
              {settingsDirty && (
                <span className="text-xs text-amber-600 dark:text-amber-300">Unsaved changes</span>
              )}
            </div>
          </div>
        </Section>
      )}

      <Section title={`Members (${memberTotal})`}>
        <input
          value={memberQuery}
          onChange={(e) => {
            setMemberQuery(e.target.value);
            setMemberOffset(0);
          }}
          placeholder="Search members by username"
          className="mb-3 w-full rounded border border-black/10 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
        />
        {members.length === 0 ? (
          <Empty>{memberQuery.trim() ? "Nobody matches." : "No members yet."}</Empty>
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
        {memberTotal > PAGE && (
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <button
              disabled={memberOffset === 0}
              onClick={() => setMemberOffset(Math.max(0, memberOffset - PAGE))}
              className="rounded border border-black/10 px-2 py-1 hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
            >
              Previous
            </button>
            <span>
              {memberOffset + 1}–{Math.min(memberOffset + PAGE, memberTotal)} of {memberTotal}
            </span>
            <button
              disabled={memberOffset + PAGE >= memberTotal}
              onClick={() => setMemberOffset(memberOffset + PAGE)}
              className="rounded border border-black/10 px-2 py-1 hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
            >
              Next
            </button>
          </div>
        )}
      </Section>

      {canManage && (
        <Section title="Invite someone">
          <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
            You can invite people who follow you. That is what stops unsolicited
            invitations, so someone who has not followed you will not appear here.
          </p>
          <input
            value={followerQuery}
            onChange={(e) => setFollowerQuery(e.target.value)}
            placeholder="Search your followers"
            className="mb-2 w-full rounded border border-black/10 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
          />
          {followers.length === 0 ? (
            <Empty>
              {followerQuery.trim()
                ? "No follower matches."
                : "Nobody follows you yet, so there is no one to invite."}
            </Empty>
          ) : (
          <div className="flex gap-2">
            <select
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              className="min-w-0 flex-1 rounded border border-black/10 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
            >
              <option value="">Choose a follower...</option>
              {followers
                .filter((f) => !members.some((m) => m.userId === f.userId))
                .map((f) => (
                  <option key={f.userId} value={f.username}>
                    {f.username}
                  </option>
                ))}
            </select>
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
          )}
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
          <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
            A tag marked <span className="text-emerald-600 dark:text-emerald-300">allows joining</span>{" "}
            opens this folder to everyone carrying the same tag, as a viewer, with no
            request to approve. Remove the tag to close it again.
          </p>
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

      {canManage && (
        <Section title="Danger zone">
          <div className="rounded border border-red-500/30 p-3">
            <p className="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">
              Transfer ownership
            </p>
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              The new owner must already be a member. You stay in the folder as an editor.
            </p>
            {transferable.length === 0 ? (
              <Empty>Invite someone first — there is no one to transfer to.</Empty>
            ) : (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <select
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                  className="min-w-0 flex-1 rounded border border-black/10 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
                >
                  <option value="">Choose a member...</option>
                  {transferable.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.username}
                    </option>
                  ))}
                </select>
                <button
                  disabled={busy || !transferTo}
                  onClick={() => setConfirming({ kind: "transfer" })}
                  className="rounded border border-red-500/40 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                >
                  Transfer
                </button>
              </div>
            )}

            <p className="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">
              Delete folder
            </p>
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              Removes the folder and every file in it, on this device and everywhere it
              has synced.
            </p>
            <button
              disabled={busy}
              onClick={() => setConfirming({ kind: "delete" })}
              className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              Delete folder
            </button>
          </div>
        </Section>
      )}

      {confirming?.kind === "transfer" && (
        <ConfirmModal
          title="Transfer ownership"
          message={`Make ${
            members.find((m) => m.userId === transferTo)?.username ?? "this member"
          } the owner of ${detail.name}? You become an editor and cannot undo this yourself.`}
          confirmLabel="Transfer"
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={async () => {
            await send(
              `${base}/owner`,
              { method: "POST", body: JSON.stringify({ userId: transferTo }) },
              "Ownership transferred"
            );
            setConfirming(null);
            setTransferTo("");
          }}
        />
      )}

      {confirming?.kind === "delete" && (
        <ConfirmModal
          title="Delete folder"
          message={`Delete "${detail.name}" and all its files? This cannot be undone.`}
          confirmLabel="Delete"
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={async () => {
            // Folder content is owned by stored, not by the collaboration
            // layer: deleting goes through the same route the sidebar uses, so
            // the tombstone syncs to Supabase the usual way.
            setBusy(true);
            try {
              const res = await fetch(`/api/folders/${encodeURIComponent(slug)}`, {
                method: "DELETE",
              });
              if (!res.ok) throw new Error((await res.json()).error || "failed");
              toast.success(`Deleted "${detail.name}"`);
              window.location.assign("/vault");
            } catch (err: any) {
              toast.error(err.message);
              setBusy(false);
              setConfirming(null);
            }
          }}
        />
      )}

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
