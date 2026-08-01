"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmModal from "@/components/modals/ConfirmModal";
import MemberRow from "@/components/collab/MemberRow";
import TagChip from "@/components/collab/TagChip";
import { SkeletonPanel } from "@/components/layout/Skeleton";
import { useToast } from "@/components/toast/ToastProvider";
import type {
  FolderDetail,
  FolderRole,
  FolderTag,
  Invitation,
  JoinRequest,
  Member,
  UserTag,
  Visibility,
} from "@/lib/collab/types";

// How many people a list shows at once. Small on purpose: these lists have no
// ceiling, and the search box is the way through a long one.
const PAGE = 10;

// Owner console for one folder. Every control here is also enforced in the
// database — a non-owner who loads this sees the read-only view because the
// server refused, not because the panel decided to hide anything.
//
// Rendered in two places from one definition, same as AccountPanel: inside the
// workspace's content column (AppShell, with `onClose`/`onDeleted`, reached from
// the sidebar's share icon) and as the standalone
// /vault/[folder]/manage page for a deep link.
export default function FolderManagePanel({
  slug,
  onClose,
  onDeleted,
}: {
  slug: string;
  onClose?: () => void;
  /** Called instead of navigating to /vault once the folder is gone. */
  onDeleted?: () => void;
}) {
  const toast = useToast();

  const [detail, setDetail] = useState<FolderDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [memberTotal, setMemberTotal] = useState(0);
  // `memberQuery` is the live input; `memberSearch` is what's actually applied
  // — search waits for Enter rather than firing per keystroke, and clearing
  // the box back to empty removes the filter rather than blanking the roster.
  const [memberQuery, setMemberQuery] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
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
  const [followerSearch, setFollowerSearch] = useState("");
  const [inviteRole, setInviteRole] = useState<FolderRole>("viewer");
  // Tags placed on a folder are picked from tags the caller has already
  // created elsewhere (Account settings), not typed fresh here — a folder's
  // tag list is not where a new tag gets invented.
  const [createdTags, setCreatedTags] = useState<UserTag[]>([]);
  const [selectedTag, setSelectedTag] = useState("");
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
  // whole console. Fires on mount/offset/submitted-search change only — never
  // per keystroke.
  const loadMembers = useCallback(
    async (offset: number) => {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (memberSearch) params.set("q", memberSearch);
      const res = await fetch(`${base}/members?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setMembers(data.members ?? []);
      setMemberTotal(data.total ?? 0);
    },
    [base, memberSearch]
  );

  useEffect(() => {
    loadMembers(memberOffset);
  }, [loadMembers, memberOffset]);

  const submitMemberSearch = () => {
    setMemberSearch(memberQuery.trim());
    setMemberOffset(0);
  };

  // Only followers can be invited, and only a page of them is fetched — the
  // search box is what reaches the rest. Fires on mount and on a submitted
  // search, never per keystroke.
  useEffect(() => {
    const params = new URLSearchParams({ direction: "followers", limit: String(PAGE) });
    if (followerSearch) params.set("q", followerSearch);
    fetch(`/api/collab/me/follows?${params}`)
      .then((r) => (r.ok ? r.json() : { people: [] }))
      .then((d) => setFollowers(d.people ?? []))
      .catch(() => {});
  }, [followerSearch]);

  // The "add a tag" picker offers tags the caller has already created
  // (Account settings), never a fresh free-text one.
  useEffect(() => {
    fetch("/api/collab/me/tags")
      .then((r) => (r.ok ? r.json() : { created: [] }))
      .then((d) => setCreatedTags(d.created ?? []))
      .catch(() => {});
  }, []);

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
      await Promise.all([load(), loadMembers(memberOffset)]);
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

  // The console is a title plus five cards; the skeleton is the same shape at
  // the same width, so nothing shifts when the folder arrives.
  if (loading) return <SkeletonPanel cards={5} maxWidth="max-w-3xl" />;

  if (needsAuth) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
          Sign in to manage folder sharing.
        </p>
        <a
          href={`/auth/sign-in?next=/vault/${encodeURIComponent(slug)}/manage`}
          className="ui-btn ui-btn-primary px-4"
        >
          Sign in
        </a>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">{error ?? "Folder not found."}</p>
        <BackControl onClose={onClose} className="mt-4 inline-block" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8 flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            {detail.name}
          </h1>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            owned by {detail.ownerUsername} · {detail.documentCount} notes
          </p>
        </div>
        <BackControl onClose={onClose} className="shrink-0" />
      </div>

      {!canManage && (
        <p className="ui-rise mb-6 rounded-md border border-black/10 bg-black/[0.02] px-3 py-2.5 text-xs leading-relaxed text-gray-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-400">
          You are a {detail.myRole ?? "guest"} in this folder. Only the owner can change its
          settings.
        </p>
      )}

      {canManage && draft && (
        <Section title="Sharing" index={0}>
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
              <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                Description
              </label>
              <textarea
                value={draft.description}
                rows={3}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="What is in this folder?"
                className="ui-field resize-y"
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
                className="ui-btn ui-btn-sm ui-btn-primary"
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
                className="ui-btn ui-btn-sm ui-btn-secondary"
              >
                Discard
              </button>
              {settingsDirty && (
                <span className="ui-rise text-xs text-amber-600 dark:text-amber-300">
                  Unsaved changes
                </span>
              )}
            </div>
          </div>
        </Section>
      )}

      <Section title={`Members (${memberTotal})`} index={1}>
        <input
          value={memberQuery}
          onChange={(e) => setMemberQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitMemberSearch()}
          placeholder="Search members by username — press Enter"
          className="ui-field ui-field-sm mb-3"
        />
        {members.length === 0 ? (
          <Empty>{memberSearch ? "Nobody matches." : "No members yet."}</Empty>
        ) : (
          <div className="-mx-2">
            {members.map((m, i) => (
              <div
                key={m.userId}
                style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}
                className="ui-rise"
              >
                <MemberRow
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
              </div>
            ))}
          </div>
        )}
        {memberTotal > PAGE && (
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <button
              disabled={memberOffset === 0}
              onClick={() => setMemberOffset(Math.max(0, memberOffset - PAGE))}
              className="ui-btn ui-btn-xs ui-btn-secondary font-normal"
            >
              Previous
            </button>
            <span>
              {memberOffset + 1}–{Math.min(memberOffset + PAGE, memberTotal)} of {memberTotal}
            </span>
            <button
              disabled={memberOffset + PAGE >= memberTotal}
              onClick={() => setMemberOffset(memberOffset + PAGE)}
              className="ui-btn ui-btn-xs ui-btn-secondary font-normal"
            >
              Next
            </button>
          </div>
        )}
      </Section>

      {canManage && (
        <Section title="Invite someone" index={2}>
          <p className="mb-4 max-w-prose text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            You can invite people who follow you. That is what stops unsolicited
            invitations, so someone who has not followed you will not appear here.
          </p>
          <input
            value={followerQuery}
            onChange={(e) => setFollowerQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setFollowerSearch(followerQuery.trim())}
            placeholder="Search your followers — press Enter"
            className="ui-field ui-field-sm mb-2"
          />
          {followers.length === 0 ? (
            <Empty>
              {followerSearch
                ? "No follower matches."
                : "Nobody follows you yet, so there is no one to invite."}
            </Empty>
          ) : (
            <div className="flex gap-2">
              <select
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="ui-field ui-field-sm min-w-0 flex-1"
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
                className="ui-field ui-field-sm w-auto shrink-0 px-2"
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
                className="ui-btn ui-btn-sm ui-btn-primary shrink-0"
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
        <Section title={`Join requests (${requests.length})`} index={3}>
          {requests.length === 0 ? (
            <Empty>No pending requests.</Empty>
          ) : (
            <div className="space-y-2">
              {requests.map((r, i) => (
                <div
                  key={r.id}
                  style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}
                  className="ui-rise flex items-center gap-3 rounded-md border border-black/10 px-3 py-2.5 transition-colors duration-150 ease-out hover:border-black/20 dark:border-white/10 dark:hover:border-white/20"
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
                    className="ui-btn ui-btn-xs ui-btn-primary shrink-0"
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
                    className="ui-btn ui-btn-xs ui-btn-secondary shrink-0"
                  >
                    Reject
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      <Section title="Tags" index={4}>
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
          <p className="mb-4 max-w-prose text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            Every tag on a folder opens it to anyone carrying the same tag, as a viewer,
            with no request to approve. Remove the tag to close it again.
          </p>
        )}

        {canManage && (() => {
          const available = createdTags.filter((ct) => !tags.some((t) => t.slug === ct.slug));
          return available.length === 0 ? (
            <Empty>
              {createdTags.length === 0
                ? "You haven't created any tags yet — add one from Account settings first."
                : "Every tag you've created is already on this folder."}
            </Empty>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
                className="ui-field ui-field-sm min-w-0 flex-1"
              >
                <option value="">Choose a tag...</option>
                {available.map((ct) => (
                  <option key={ct.slug} value={ct.label}>
                    {ct.label}
                  </option>
                ))}
              </select>
              <button
                disabled={busy || !selectedTag}
                onClick={async () => {
                  const ok = await send(
                    `${base}/tags`,
                    { method: "POST", body: JSON.stringify({ tag: selectedTag }) },
                    "Tag added"
                  );
                  if (ok) setSelectedTag("");
                }}
                className="ui-btn ui-btn-sm ui-btn-primary shrink-0"
              >
                Add
              </button>
            </div>
          );
        })()}
      </Section>

      {canManage && (
        <Section title="Danger zone" tone="danger" index={5}>
          <div>
            <p className="mb-1 text-sm font-medium text-gray-900 dark:text-gray-100">
              Transfer ownership
            </p>
            <p className="mb-3 max-w-prose text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              The new owner must already be a member. You stay in the folder as an editor.
            </p>
            {transferable.length === 0 ? (
              <Empty>Invite someone first — there is no one to transfer to.</Empty>
            ) : (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <select
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                  className="ui-field ui-field-sm min-w-0 flex-1"
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
                  className="ui-btn ui-btn-sm ui-btn-danger-outline shrink-0"
                >
                  Transfer
                </button>
              </div>
            )}

            <p className="mb-1 mt-6 border-t border-red-500/20 pt-6 text-sm font-medium text-gray-900 dark:text-gray-100">
              Delete folder
            </p>
            <p className="mb-3 max-w-prose text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              Removes the folder and every file in it, on this device and everywhere it
              has synced.
            </p>
            <button
              disabled={busy}
              onClick={() => setConfirming({ kind: "delete" })}
              className="ui-btn ui-btn-sm ui-btn-danger"
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
              // In the workspace the tree is already on screen: refresh it and
              // close, rather than reloading the whole app to reach the same view.
              if (onDeleted) onDeleted();
              else window.location.assign("/vault");
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
    </div>
  );
}

/**
 * The way out. A button when the console is a pane the shell can close, a link
 * when it is a page — a link that doesn't navigate and a button that does are
 * both lies about what will happen.
 */
function BackControl({ onClose, className = "" }: { onClose?: () => void; className?: string }) {
  if (onClose) {
    return (
      <button
        onClick={onClose}
        className={`ui-btn ui-btn-sm ui-btn-ghost font-normal text-blue-600 dark:text-blue-400 ${className}`}
      >
        Back to notes
      </button>
    );
  }
  return (
    <a
      href="/vault"
      className={`ui-focus rounded text-sm text-blue-600 transition-colors duration-150 ease-out hover:text-blue-500 dark:text-blue-400 ${className}`}
    >
      Back to vault
    </a>
  );
}

/**
 * One panel of the console. Cards rather than a single long form: the console
 * is six unrelated concerns stacked, and the borders are what stop it reading
 * as one dense sheet. `tone="danger"` only changes the border colour; `index`
 * staggers its entrance so the console assembles instead of appearing.
 */
function Section({
  title,
  tone = "default",
  index,
  children,
}: {
  title: string;
  tone?: "default" | "danger";
  index: number;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
      className={`ui-rise mb-4 rounded-lg border p-5 transition-colors duration-150 ease-out ${
        tone === "danger"
          ? "border-red-500/30 bg-red-500/[0.02] hover:border-red-500/50"
          : "border-black/10 bg-black/[0.01] hover:border-black/20 dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-white/20"
      }`}
    >
      <h2
        className={`mb-4 text-xs font-semibold uppercase tracking-wide ${
          tone === "danger"
            ? "text-red-600 dark:text-red-400"
            : "text-gray-500 dark:text-gray-400"
        }`}
      >
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
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="ui-focus mt-0.5 h-4 w-4 shrink-0 rounded accent-blue-600"
      />
      <span>
        <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{label}</span>
        <span className="mt-0.5 block max-w-prose text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {hint}
        </span>
      </span>
    </label>
  );
}
