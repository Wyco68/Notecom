"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmModal from "@/components/modals/ConfirmModal";
import MemberRow from "@/components/collab/MemberRow";
import TagChip from "@/components/collab/TagChip";
import PanelHeader from "@/components/layout/PanelHeader";
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
  // Topics are typed here; addFolderTag reuses an existing topic with the
  // same slug, so "#OS" and "os" land on one.
  const [newTopic, setNewTopic] = useState("");
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
        <p className="mb-3 ui-empty">
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
        <p className="text-sm text-danger">{error ?? "Folder not found."}</p>
        <BackControl onClose={onClose} className="mt-4 inline-block" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <PanelHeader
        title={detail.name}
        subtitle={`${detail.ownerUsername} · ${detail.documentCount} notes`}
        onClose={onClose}
        className="mb-8"
      />

      {!canManage && (
        <p className="ui-rise mb-6 text-sm text-muted">
          You&apos;re {detail.myRole === "editor" ? "an" : "a"} {detail.myRole ?? "guest"} here. Only the owner changes settings.
        </p>
      )}

      {canManage && draft && (
        <Section title="Sharing" index={0}>
          <div className="space-y-3">
            <Toggle
              label="Public"
              hint="Anyone signed in can find it. Files stay members-only; joining needs your OK."
              checked={draft.visibility === "public"}
              disabled={busy}
              onChange={(v) =>
                setDraft({ ...draft, visibility: v ? "public" : "private" })
              }
            />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">
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
                Save
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
                <span className="ui-rise text-xs text-warn">Unsaved</span>
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
          placeholder="Search members"
          aria-label="Search members by username, then press Enter"
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
          <div className="mt-3 flex items-center gap-2 text-xs text-muted">
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
          <p className="mb-3 text-xs text-muted">Only people who follow you can be invited.</p>
          <input
            value={followerQuery}
            onChange={(e) => setFollowerQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setFollowerSearch(followerQuery.trim())}
            placeholder="Search followers"
            aria-label="Search your followers, then press Enter"
            className="ui-field ui-field-sm mb-2"
          />
          {followers.length === 0 ? (
            <Empty>
              {followerSearch
                ? "No follower matches."
                : "No followers yet."}
            </Empty>
          ) : (
            <div className="flex gap-2">
              <select
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="ui-field ui-field-sm min-w-0 flex-1"
              >
                <option value="">Choose a follower</option>
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
            <p className="mt-2 text-xs text-muted">
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
                  className="ui-rise flex items-center gap-3 rounded-md border border-line px-3 py-2.5 transition-colors duration-150 ease-out hover:border-ink/25"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink">{r.username}</div>
                    {r.message && (
                      <p className="truncate text-xs text-muted">
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

      <Section title="Topics" index={4}>
        {tags.length === 0 ? (
          <Empty>No topics yet.</Empty>
        ) : (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <TagChip
                key={t.slug}
                label={`#${t.label || t.slug}`}
                onRemove={
                  canManage
                    ? () =>
                        send(
                          `${base}/tags?tag=${encodeURIComponent(t.slug)}`,
                          { method: "DELETE" },
                          "Topic removed"
                        )
                    : undefined
                }
              />
            ))}
          </div>
        )}

        {canManage && (
          <p className="mb-3 text-xs text-muted">Topics help people find it. They don&apos;t grant access.</p>
        )}

        {canManage && (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const topic = newTopic.trim().replace(/^#/, "");
              if (topic.length < 2) return;
              const ok = await send(
                `${base}/tags`,
                { method: "POST", body: JSON.stringify({ tag: topic }) },
                "Topic added"
              );
              if (ok) setNewTopic("");
            }}
          >
            <input
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              placeholder="e.g. operating-systems"
              aria-label="New topic"
              maxLength={40}
              className="ui-field ui-field-sm min-w-0 flex-1"
            />
            <button
              type="submit"
              disabled={busy || newTopic.trim().replace(/^#/, "").length < 2}
              className="ui-btn ui-btn-sm ui-btn-primary shrink-0"
            >
              Add
            </button>
          </form>
        )}
      </Section>

      {canManage && (
        <Section title="Danger zone" tone="danger" index={5}>
          <div>
            <p className="mb-1 text-sm font-semibold text-ink">Transfer ownership</p>
            <p className="mb-3 text-xs text-muted">To a member. You stay as an editor.</p>
            {transferable.length === 0 ? (
              <Empty>No other members yet.</Empty>
            ) : (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <select
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                  className="ui-field ui-field-sm min-w-0 flex-1"
                >
                  <option value="">Choose a member</option>
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

            <p className="mb-1 mt-6 border-t border-line pt-6 text-sm font-semibold text-ink">Delete folder</p>
            <p className="mb-3 text-xs text-muted">Deletes the folder and every file in it, for everyone.</p>
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
        className={`ui-btn ui-btn-sm ui-btn-ghost font-normal text-accent ${className}`}
      >
        Back to notes
      </button>
    );
  }
  return (
    <a
      href="/vault"
      className={`ui-focus rounded text-sm text-accent transition-colors duration-150 ease-out hover:text-accent/80 ${className}`}
    >
      Back to vault
    </a>
  );
}

/**
 * One section of the console: a ruled row, its title in the left column.
 * `tone="danger"` writes the title in red pen; `index` staggers its entrance.
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
      className="ui-rise grid gap-x-8 gap-y-3 border-t border-line py-7 sm:grid-cols-[10rem_minmax(0,1fr)]"
    >
      <h2 className={`text-sm font-semibold ${tone === "danger" ? "text-danger" : "text-ink"}`}>{title}</h2>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="ui-empty">{children}</p>;
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
        className="ui-focus mt-0.5 h-4 w-4 shrink-0 rounded accent-[rgb(var(--accent))]"
      />
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-xs text-muted">
          {hint}
        </span>
      </span>
    </label>
  );
}
