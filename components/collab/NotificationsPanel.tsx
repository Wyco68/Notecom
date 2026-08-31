"use client";

import Avatar from "./Avatar";
import RoleBadge from "./RoleBadge";
import TagChip from "./TagChip";
import BellIcon from "@/components/icons/BellIcon";
import RefreshIcon from "@/components/icons/RefreshIcon";
import PanelHeader from "@/components/layout/PanelHeader";
import { SkeletonCard } from "@/components/layout/Skeleton";
import {
  useNotifications,
  type NotificationItem,
  type NotificationKind,
} from "./NotificationsProvider";

// Everything waiting on the reader's answer, in one place.
//
// This replaces three separate blocks that used to stack in the sidebar
// (InvitationsInbox, FollowRequestsInbox, TagGrantsInbox). Each rendered
// nothing when empty, which meant the whole surface was unreachable exactly
// when a reader went looking for it — "did that invite arrive?" had no page to
// answer it, and a pending item pushed the folder tree down the sidebar to say
// so. The Notifications row in the sidebar's nav group (SidebarNav) is always
// there, pending or not; this is what it opens.
//
// Rendered in two places from one definition, like AccountPanel and
// DiscoverPanel: inside the workspace's content column (AppShell, with
// `onClose`) and as the standalone /notifications page (no `onClose`).

const KIND_LABEL: Record<NotificationKind, string> = {
  invitation: "Folder invite",
  follow: "Follow request",
  tag: "Tag offer",
};

// One tone per kind, matching what the tone already means elsewhere in the
// app: blue for a folder role, emerald for a tag that opens access, neutral
// for a follow, which grants nothing on its own.
const KIND_TONE: Record<NotificationKind, string> = {
  invitation: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  follow: "border-black/10 bg-black/5 text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300",
  tag: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

export default function NotificationsPanel({
  onClose,
  onOpenDiscover,
}: {
  onClose?: () => void;
  /** Opens Discover in the content column; falls back to navigating there. */
  onOpenDiscover?: () => void;
}) {
  const state = useNotifications();

  // No provider means collaboration isn't configured on this build — the same
  // condition under which AccountControl renders nothing.
  if (!state) return null;

  const { items, count, loaded, failedKinds, needsAuth, busy, refresh, respond } = state;

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-8">
      <PanelHeader
        title="Notifications"
        subtitle="Everything waiting on an answer. Accepting a tag or an invitation is what grants the access it describes."
        badge={
          count > 0 ? (
            <span
              data-numeric
              className="ui-badge border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
            >
              {count}
            </span>
          ) : null
        }
        actions={
          <button
            onClick={() => refresh()}
            title="Check for new notifications"
            aria-label="Check for new notifications"
            className="ui-icon-btn h-7 w-7"
          >
            <RefreshIcon className="h-4 w-4" />
          </button>
        }
        onClose={onClose}
      />

      {!loaded ? (
        <div className="animate-pulse" role="status" aria-label="Loading notifications">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      ) : needsAuth ? (
        // A 401 is answered by signing in, not by a retry button that will
        // keep failing. Same branch DiscoverPanel and PeoplePanel already have.
        <div className="ui-card px-6 py-14 text-center">
          <p className="ui-empty">Your session expired.</p>
          <a href="/auth/sign-in?next=/notifications" className="ui-btn ui-btn-primary mt-4 px-4">
            Sign in
          </a>
        </div>
      ) : failedKinds.size === 3 ? (
        // Distinct from empty on purpose: "nothing waiting on you" is a claim
        // about the reader's inbox, and it must never be made on the strength
        // of a request that failed.
        <div className="ui-card px-6 py-14 text-center">
          <p className="ui-empty">Couldn&apos;t load your notifications.</p>
          <button onClick={() => refresh()} className="ui-btn ui-btn-sm ui-btn-secondary mt-4 font-normal">
            Try again
          </button>
        </div>
      ) : items.length === 0 && failedKinds.size === 0 ? (
        <EmptyState onOpenDiscover={onOpenDiscover} />
      ) : (
        <>
          {/* One or two of the three reads failed. The list below is real but
              incomplete, and saying so is the only honest option — silently
              rendering two thirds of an inbox is how a pending invitation goes
              unanswered. */}
          {failedKinds.size > 0 && (
            <div className="ui-card mb-3 flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Couldn&apos;t load {listKinds(failedKinds)} — this list may be incomplete.
              </p>
              <button
                onClick={() => refresh()}
                className="ui-btn ui-btn-xs ui-btn-secondary font-normal"
              >
                Retry
              </button>
            </div>
          )}
        <ul className="space-y-3">
          {items.map((item, i) => (
            <li
              key={item.id}
              className="ui-rise"
              style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}
            >
              <NotificationRow
                item={item}
                busy={busy.has(item.id)}
                onRespond={(accept) => respond(item, accept)}
              />
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  );
}

/** "folder invites", "follow requests and tag offers", etc. */
function listKinds(kinds: Set<NotificationKind>): string {
  const names: Record<NotificationKind, string> = {
    invitation: "folder invites",
    follow: "follow requests",
    tag: "tag offers",
  };
  const list = (["invitation", "follow", "tag"] as NotificationKind[])
    .filter((k) => kinds.has(k))
    .map((k) => names[k]);
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

function EmptyState({ onOpenDiscover }: { onOpenDiscover?: () => void }) {
  const cls = "ui-btn ui-btn-sm ui-btn-secondary mt-5 font-normal";
  return (
    <div className="ui-card flex flex-col items-center px-6 py-14 text-center">
      <BellIcon className="mb-3 h-6 w-6 text-gray-400 dark:text-gray-600" />
      <p className="ui-empty">Nothing waiting on you.</p>
      <p className="mt-1 max-w-sm text-xs text-gray-400 dark:text-gray-500">
        Folder invitations, follow requests and tag offers land here.
      </p>
      {/* A button inside the shell, where Discover opens in place; a link only
          on the standalone route, where it genuinely has to navigate.
          Navigating out of the workspace would tear down the tree, the open
          document and any running generation to reach a panel that is one
          state change away. */}
      {onOpenDiscover ? (
        <button onClick={onOpenDiscover} className={cls}>
          Find folders to join
        </button>
      ) : (
        <a href="/discover" className={cls}>
          Find folders to join
        </a>
      )}
    </div>
  );
}

function NotificationRow({
  item,
  busy,
  onRespond,
}: {
  item: NotificationItem;
  busy: boolean;
  onRespond: (accept: boolean) => void;
}) {
  const { face, title, detail } = describe(item);

  return (
    <article className="ui-card ui-card-hover p-4">
      <div className="flex items-start gap-3">
        {/* `flex`, not a bare inline span: Avatar's root is a <span> whose
            own h-8/w-8 only take effect once something makes it block-level,
            and an inline wrapper collapsed it to a 2px sliver with the
            initials spilling out. Everywhere else it is already a flex child. */}
        <span className="mt-0.5 flex shrink-0">{face}</span>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className={`ui-badge ${KIND_TONE[item.kind]}`}>{KIND_LABEL[item.kind]}</span>
            <RelativeTime iso={item.createdAt} />
          </div>
          <p className="text-sm text-gray-900 dark:text-gray-100">{title}</p>
          {detail && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{detail}</p>
          )}
        </div>

        {/* Fixed to the top-right of the card rather than under the text, so
            the Accept buttons line up down the list however long each message
            runs. They wrap under the text on a narrow screen. */}
        <div className="flex shrink-0 gap-2 max-sm:hidden">
          <Actions busy={busy} onRespond={onRespond} />
        </div>
      </div>

      <div className="mt-3 flex gap-2 sm:hidden">
        <Actions busy={busy} onRespond={onRespond} stretch />
      </div>
    </article>
  );
}

function Actions({
  busy,
  onRespond,
  stretch = false,
}: {
  busy: boolean;
  onRespond: (accept: boolean) => void;
  stretch?: boolean;
}) {
  const width = stretch ? "flex-1" : "";
  return (
    <>
      <button
        onClick={() => onRespond(true)}
        disabled={busy}
        className={`ui-btn ui-btn-xs ui-btn-primary ${width}`}
      >
        Accept
      </button>
      <button
        onClick={() => onRespond(false)}
        disabled={busy}
        className={`ui-btn ui-btn-xs ui-btn-secondary ${width}`}
      >
        Decline
      </button>
    </>
  );
}

/**
 * The identity mark, headline and consequence line for one item. The
 * consequence is spelled out for tags and invitations on purpose: "accept a
 * tag" otherwise reads as harmless when it is the step that opens folders.
 */
function describe(item: NotificationItem): {
  face: React.ReactNode;
  title: React.ReactNode;
  detail: string | null;
} {
  switch (item.kind) {
    case "invitation":
      return {
        face: <Avatar username={item.data.inviterUsername} avatarUrl={item.data.inviterAvatarUrl} size={8} />,
        title: (
          <>
            <strong className="font-medium">{item.data.inviterUsername}</strong> invited you to{" "}
            <strong className="font-medium">{item.data.folderName}</strong>{" "}
            <RoleBadge role={item.data.role} />
          </>
        ),
        detail: "Accepting adds the folder to your vault with that role.",
      };
    case "follow":
      return {
        face: <Avatar username={item.data.username} avatarUrl={item.data.avatarUrl} size={8} />,
        title: (
          <>
            <strong className="font-medium">{item.data.username}</strong> asked to follow you.
          </>
        ),
        detail: "Accepting lets them be offered a tag or invited to your folders.",
      };
    case "tag":
      return {
        face: <Avatar username={item.data.granterUsername} avatarUrl={item.data.granterAvatarUrl} size={8} />,
        title: (
          <>
            <strong className="font-medium">{item.data.granterUsername}</strong> offered you{" "}
            <TagChip label={item.data.label || item.data.slug} grantsJoin />
          </>
        ),
        detail: "Accepting shares every folder tagged this way with you.",
      };
  }
}

function RelativeTime({ iso }: { iso: string }) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;

  const seconds = Math.round((Date.now() - then.getTime()) / 1000);
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    seconds < 60
      ? [seconds, "second"]
      : seconds < 3600
        ? [Math.round(seconds / 60), "minute"]
        : seconds < 86400
          ? [Math.round(seconds / 3600), "hour"]
          : seconds < 2592000
            ? [Math.round(seconds / 86400), "day"]
            : [Math.round(seconds / 2592000), "month"];

  return (
    <time
      dateTime={iso}
      title={then.toLocaleString()}
      className="text-xs text-gray-400 dark:text-gray-500"
    >
      {new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-value, unit)}
    </time>
  );
}
