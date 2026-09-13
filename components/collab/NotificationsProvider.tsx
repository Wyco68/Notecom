"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useToast } from "@/components/toast/ToastProvider";
import type { FollowRequest, Invitation } from "@/lib/collab/types";

// One source for everything waiting on the reader's answer: folder
// invitations, incoming follow requests and offered tags.
//
// It exists because the count and the list are read from two different places
// — the sidebar's nav group and the notifications panel — and they were
// guaranteed to disagree if each fetched its own copy: accepting an invitation
// in the panel would leave the badge still claiming it was pending. One fetch,
// one state, both read it.
//
// These are all *actionable* items, never a feed: there is no read/unread flag
// anywhere, because an item leaves the list by being answered and nothing
// else. That is also why no migration came with this — the three endpoints it
// reads already existed (docs/api-contract.md).

// Same gate as AccountControl. Without it the provider would hand out a
// context on a build with no Supabase configured, the nav group would render
// three destinations into panels that cannot work, and three collab endpoints
// would be polled on every focus for nothing.
const ENABLED = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

export type NotificationKind = "invitation" | "follow";

/** One pending item, normalised so the panel can render a single list. */
export type NotificationItem =
  | { kind: "invitation"; id: string; createdAt: string; data: Invitation }
  | { kind: "follow"; id: string; createdAt: string; data: FollowRequest };

interface NotificationsValue {
  items: NotificationItem[];
  count: number;
  /** False only until the first fetch answers — distinct from "none pending". */
  loaded: boolean;
  /** Which kinds couldn't be read. Empty means the list below is complete. */
  failedKinds: Set<NotificationKind>;
  /** A read came back 401 — the answer is signing in, not retrying. */
  needsAuth: boolean;
  /** Ids currently being answered, so each row disables independently. */
  busy: Set<string>;
  refresh: () => Promise<void>;
  respond: (item: NotificationItem, accept: boolean) => Promise<void>;
}

const NotificationsContext = createContext<NotificationsValue | null>(null);

/**
 * Read the notification state. Returns null outside a provider, and on a build
 * with no collaboration configured, which is what lets the nav group and the
 * panel render nothing rather than throw.
 */
export function useNotifications() {
  return useContext(NotificationsContext);
}

/**
 * One read. `null` means "couldn't read it", which is never the same as "it
 * was empty" — the caller has to be able to tell those apart. `status` is
 * carried out so 401 can be answered with a sign-in prompt rather than a retry
 * button that will keep failing, matching PeoplePanel and DiscoverPanel.
 */
async function getJson<T>(url: string): Promise<{ data: T | null; status: number }> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { data: null, status: res.status };
    return { data: (await res.json()) as T, status: res.status };
  } catch {
    // No response at all: offline, DNS, aborted.
    return { data: null, status: 0 };
  }
}

interface InvitationsBody {
  invitations?: Invitation[];
}
interface FollowRequestsBody {
  requests?: FollowRequest[];
}

export default function NotificationsProvider({
  children,
  /** Answering an item can add a folder to the tree — the shell re-reads it. */
  onChanged,
}: {
  children: React.ReactNode;
  onChanged?: () => void;
}) {
  if (!ENABLED) return <>{children}</>;
  return <Live onChanged={onChanged}>{children}</Live>;
}

function Live({
  children,
  onChanged,
}: {
  children: React.ReactNode;
  onChanged?: () => void;
}) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [follows, setFollows] = useState<FollowRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failedKinds, setFailedKinds] = useState<Set<NotificationKind>>(() => new Set());
  const [needsAuth, setNeedsAuth] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const toast = useToast();

  // Monotonic, bumped by every read *and* every answer. A read that started
  // before an item was accepted must not be allowed to land after it and put
  // the answered item back on screen.
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    const [inv, fol] = await Promise.all([
      getJson<InvitationsBody>("/api/collab/invitations"),
      getJson<FollowRequestsBody>("/api/collab/me/follow-requests"),
    ]);
    if (mine !== generation.current) return;

    // Each list is replaced only if its own read succeeded. A dropped packet
    // or an expired session used to empty the list and read as "nothing
    // pending", which is the one thing it must never say when it doesn't know.
    if (inv.data) setInvitations(inv.data.invitations ?? []);
    if (fol.data) setFollows(fol.data.requests ?? []);

    // Per kind, not just all-or-nothing. One endpoint 429ing (three requests
    // per refresh share one 60/min budget) used to leave the panel asserting a
    // complete inbox built from two thirds of one — "nothing waiting on you"
    // while an invitation sat pending. Wrong emptiness and wrong completeness
    // are the same lie told at different scales.
    const missing = new Set<NotificationKind>();
    if (!inv.data) missing.add("invitation");
    if (!fol.data) missing.add("follow");
    setFailedKinds(missing);
    setNeedsAuth([inv, fol].some((r) => r.status === 401));
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // An invitation sent while the tab sat open should not need a reload to
  // appear. `focus` and `visibilitychange` both fire on an ordinary tab
  // switch, so without this guard one alt-tab would cost six requests — all of
  // which middleware.ts bills against the same 60/minute budget as the pages.
  // Same shape as AppShell's own tree refresh, deliberately.
  const lastAutoRefresh = useRef(0);
  useEffect(() => {
    const MIN_INTERVAL_MS = 15_000;
    const maybeRefresh = () => {
      const now = Date.now();
      if (now - lastAutoRefresh.current < MIN_INTERVAL_MS) return;
      lastAutoRefresh.current = now;
      refresh();
    };
    const onFocus = () => maybeRefresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") maybeRefresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const items = useMemo<NotificationItem[]>(() => {
    const merged: NotificationItem[] = [
      ...invitations.map(
        (data): NotificationItem => ({
          kind: "invitation",
          id: `invitation:${data.id}`,
          createdAt: data.createdAt,
          data,
        })
      ),
      ...follows.map(
        (data): NotificationItem => ({
          kind: "follow",
          id: `follow:${data.followerId}`,
          createdAt: data.createdAt,
          data,
        })
      ),
    ];
    // Newest first across all three kinds — the reader cares when something
    // arrived, not which endpoint it came from. Compared as instants rather
    // than as strings: the three endpoints are not obliged to agree forever on
    // whether they serialize `Z` or `+00:00`, and a string compare would
    // silently mis-order the day one of them changed.
    return merged.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [invitations, follows]);

  const respond = useCallback(
    async (item: NotificationItem, accept: boolean) => {
      const [url, body, ok] = requestFor(item, accept);
      setBusy((s) => new Set(s).add(item.id));
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        // Parsed defensively and *before* the status is judged: a 429 from
        // middleware or an HTML error page would otherwise surface to the
        // reader as `Unexpected token '<'` instead of what actually happened.
        const data = await res.json().catch(() => ({}) as any);
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

        toast.success(accept ? ok : "Declined");
        // Any read still in flight started before this answer; discard it
        // rather than let it put the answered item back.
        generation.current++;
        // Drop it locally rather than re-fetching all three: the row is gone
        // the moment the server agrees, with no list flicker in between.
        if (item.kind === "invitation") {
          setInvitations((list) => list.filter((i) => i.id !== item.data.id));
        } else {
          setFollows((list) => list.filter((f) => f.followerId !== item.data.followerId));
        }
        // Only an acceptance can change the tree. Declining a follow request
        // cannot, and re-reading every open folder's documents to find that
        // out is a lot of work to confirm nothing happened.
        if (accept) onChanged?.();
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setBusy((s) => {
          const next = new Set(s);
          next.delete(item.id);
          return next;
        });
      }
    },
    [onChanged, toast]
  );

  const value = useMemo<NotificationsValue>(
    () => ({
      items,
      count: items.length,
      loaded,
      failedKinds,
      needsAuth,
      busy,
      refresh,
      respond,
    }),
    [items, loaded, failedKinds, needsAuth, busy, refresh, respond]
  );

  return (
    <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  );
}

/** Endpoint, payload and success message for one kind of answer. */
function requestFor(
  item: NotificationItem,
  accept: boolean
): [string, Record<string, unknown>, string] {
  switch (item.kind) {
    case "invitation":
      return [
        "/api/collab/invitations",
        { invitationId: item.data.id, accept },
        `Joined ${item.data.folderName}`,
      ];
    case "follow":
      return [
        "/api/collab/me/follow-requests",
        { followerId: item.data.followerId, accept },
        `Accepted ${item.data.username}`,
      ];
  }
}
