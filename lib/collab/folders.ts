// Collaboration data layer: typed wrappers over the RPCs and RLS-guarded
// selects defined in supabase/migrations/.
//
// There is no authorization logic here on purpose. Every function below is a
// thin call the database is free to refuse — a returned empty list means RLS
// hid the rows, and a thrown error usually means an RPC rejected the caller.
// Adding a permission check here would create a second, weaker answer to a
// question Postgres has already answered.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { resolveAvatarUrls } from "./avatar";
import type {
  FolderDetail,
  FolderRole,
  FolderSummary,
  FolderTag,
  FollowEdge,
  FollowRequest,
  Invitation,
  JoinRequest,
  Member,
  FeedItem,
  Profile,
  UserTag,
  Visibility,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

function toSummary(row: any, ownerAvatar: string | null): FolderSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    ownerId: row.owner_id,
    ownerUsername: row.owner_username,
    ownerAvatar,
    tags: row.tags ?? [],
    joinTags: row.join_tags ?? [],
    memberCount: Number(row.member_count ?? 0),
    documentCount: Number(row.document_count ?? 0),
    myRole: (row.my_role as FolderRole) ?? null,
    createdAt: row.created_at,
  };
}

/** Batch-sign every row's `owner_avatar` and map it back through `toSummary`. */
async function toSummaries(supabase: SupabaseClient, rows: any[]): Promise<FolderSummary[]> {
  const avatars = await resolveAvatarUrls(supabase, rows.map((row) => row.owner_avatar));
  return rows.map((row) => toSummary(row, avatars.get(row.owner_avatar ?? "") ?? null));
}

/**
 * Discovery. The RPC lists public folders plus the caller's own, and its term
 * also matches topics — tags are labels now, not access (0026).
 */
export async function searchFolders(
  q?: string,
  limit = 20,
  offset = 0
): Promise<FolderSummary[]> {
  const supabase = await createClient();
  // Clamped here, not left to the RPC's own greatest/least: a non-finite or
  // absurd value (NaN, negative, a client-supplied 1e30) would otherwise
  // reach notes_search_folders as an out-of-range `integer` argument and come
  // back as a raw Postgres cast error instead of just using a sane default.
  const p_limit = Math.min(Math.max(Number.isFinite(limit) ? limit : 20, 1), 100);
  const p_offset = Math.max(Number.isFinite(offset) ? offset : 0, 0);
  const { data, error } = await supabase.rpc("notes_search_folders", {
    p_q: q?.trim() || null,
    p_limit,
    p_offset,
  });
  if (error) throw new Error(error.message);
  return toSummaries(supabase, data ?? []);
}

/** Folders the caller owns or belongs to, for their own sidebar/dashboard. */
export async function myFolders(): Promise<FolderSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notes_my_folders");
  if (error) throw new Error(error.message);
  return toSummaries(supabase, data ?? []);
}

/**
 * One folder by slug. Slugs are unique per owner, not globally, so an owner
 * username is required to disambiguate when the caller is not a member.
 */
export async function getFolder(
  slug: string,
  ownerUsername?: string
): Promise<FolderDetail | null> {
  const matches = (await searchFolders(slug, 50, 0)).filter(
    (f) => f.slug === slug && (!ownerUsername || f.ownerUsername === ownerUsername)
  );
  // Prefer a folder the caller belongs to: searching by slug can legitimately
  // match someone else's public folder of the same name.
  return matches.find((f) => f.myRole) ?? matches[0] ?? null;
}

/**
 * One page of a folder's members. Paged and searchable rather than fetched
 * whole: a popular folder's member list is unbounded, and the UI only ever
 * shows a handful at a time.
 */
export async function listMembers(
  folderId: string,
  opts: { q?: string; limit?: number; offset?: number } = {}
): Promise<{ members: Member[]; total: number }> {
  const supabase = await createClient();
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const offset = Math.max(opts.offset ?? 0, 0);
  const q = opts.q?.trim();

  // `!inner` so the username filter can reach the joined profile row.
  let query = supabase
    .from("notes_folder_members")
    .select("user_id, role, joined_at, profiles!inner(username, avatar_url)", { count: "exact" })
    .eq("folder_id", folderId);
  if (q) query = query.ilike("profiles.username", `%${q}%`);

  const { data, error, count } = await query
    .order("joined_at")
    .range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const avatars = await resolveAvatarUrls(supabase, rows.map((row: any) => row.profiles?.avatar_url));
  return {
    members: rows.map((row: any) => ({
      userId: row.user_id,
      username: row.profiles?.username ?? "unknown",
      avatarUrl: avatars.get(row.profiles?.avatar_url ?? "") ?? null,
      role: row.role,
      joinedAt: row.joined_at,
    })),
    total: count ?? 0,
  };
}

export async function listFolderTags(folderId: string): Promise<FolderTag[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes_folder_tags")
    .select("notes_tags(slug, label)")
    .eq("folder_id", folderId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({
    slug: row.notes_tags?.slug ?? "",
    label: row.notes_tags?.label ?? "",
  }));
}

const INVITATION_SELECT =
  "id, folder_id, role, status, created_at, " +
  "notes_folders(name, slug), " +
  "inviter:profiles!notes_folder_invitations_inviter_id_fkey(username, avatar_url), " +
  "invitee:profiles!notes_folder_invitations_invitee_id_fkey(username, avatar_url)";

/**
 * Pending invitations addressed to the caller — the sidebar's accept/decline
 * inbox. Explicitly filtered to `invitee_id`, not left to the table's SELECT
 * policy alone: that policy is deliberately broader (invitee, inviter, or a
 * folder manager may all see a pending row, e.g. so a manager can audit
 * what's outstanding), which is correct for other readers of this table but
 * would otherwise show the *inviter* their own sent invitation here too, with
 * nothing for them to actually accept or decline.
 */
export async function myInvitations(): Promise<Invitation[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return [];

  const { data, error } = await supabase
    .from("notes_folder_invitations")
    .select(INVITATION_SELECT)
    .eq("invitee_id", user.user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return toInvitations(supabase, data ?? []);
}

/** Invitations issued for one folder — visible to managers only, via RLS. */
export async function listFolderInvitations(folderId: string): Promise<Invitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes_folder_invitations")
    .select(INVITATION_SELECT)
    .eq("folder_id", folderId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return toInvitations(supabase, data ?? []);
}

async function toInvitations(supabase: SupabaseClient, rows: any[]): Promise<Invitation[]> {
  const avatars = await resolveAvatarUrls(
    supabase,
    rows.flatMap((row) => [row.inviter?.avatar_url, row.invitee?.avatar_url])
  );
  return rows.map((row) => ({
    id: row.id,
    folderId: row.folder_id,
    folderName: row.notes_folders?.name ?? "",
    folderSlug: row.notes_folders?.slug ?? "",
    role: row.role,
    status: row.status,
    inviterUsername: row.inviter?.username ?? "someone",
    inviterAvatarUrl: avatars.get(row.inviter?.avatar_url ?? "") ?? null,
    inviteeUsername: row.invitee?.username ?? "",
    inviteeAvatarUrl: avatars.get(row.invitee?.avatar_url ?? "") ?? null,
    createdAt: row.created_at,
  }));
}

export async function listJoinRequests(folderId: string): Promise<JoinRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes_folder_join_requests")
    .select("id, folder_id, user_id, message, status, created_at, notes_folders(name), profiles(username, avatar_url)")
    .eq("folder_id", folderId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const avatars = await resolveAvatarUrls(supabase, rows.map((row: any) => row.profiles?.avatar_url));
  return rows.map((row: any) => ({
    id: row.id,
    folderId: row.folder_id,
    folderName: row.notes_folders?.name ?? "",
    userId: row.user_id,
    username: row.profiles?.username ?? "unknown",
    avatarUrl: avatars.get(row.profiles?.avatar_url ?? "") ?? null,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
  }));
}

/* --- actions: every one is an RPC that re-checks authorization itself --- */

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    // Preserve the Postgres SQLSTATE (42501, P0002, ...) the RPCs raise —
    // route-helpers.ts maps on it first, before falling back to message text.
    const wrapped = new Error(error.message) as Error & { code?: string };
    wrapped.code = error.code;
    throw wrapped;
  }
  return data;
}

export const inviteMember = (folderId: string, username: string, role: FolderRole) =>
  rpc("notes_invite_member", { p_folder: folderId, p_username: username, p_role: role });

export const respondInvitation = (invitationId: string, accept: boolean) =>
  rpc("notes_respond_invitation", { p_invitation: invitationId, p_accept: accept });

export const requestJoin = (folderId: string, message?: string) =>
  rpc("notes_request_join", { p_folder: folderId, p_message: message ?? null }) as Promise<string>;

export const respondJoinRequest = (requestId: string, approve: boolean) =>
  rpc("notes_respond_join_request", { p_request: requestId, p_approve: approve });

export const setMemberRole = (folderId: string, userId: string, role: FolderRole) =>
  rpc("notes_set_member_role", { p_folder: folderId, p_user: userId, p_role: role });

export const removeMember = (folderId: string, userId: string) =>
  rpc("notes_remove_member", { p_folder: folderId, p_user: userId });

export const leaveFolder = (folderId: string) =>
  rpc("notes_leave_folder", { p_folder: folderId });

/* --- settings and tags: plain writes, guarded by the folder policies --- */

export async function updateFolderSettings(
  folderId: string,
  patch: {
    visibility?: Visibility;
    description?: string | null;
  }
): Promise<void> {
  const supabase = await createClient();
  const row: Record<string, unknown> = {};
  if (patch.visibility !== undefined) row.visibility = patch.visibility;
  if (patch.description !== undefined) row.description = patch.description;
  if (!Object.keys(row).length) return;

  const { error } = await supabase.from("notes_folders").update(row).eq("id", folderId);
  if (error) throw new Error(error.message);
}

/** Slugify a tag label the same way folder slugs are made: lowercase, dashed. */
export function tagSlug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Resolve a label to a tag id, creating the tag only if the slug is new. The
 * vocabulary is shared between folders and users, so both sides come through
 * here and neither invents a duplicate row.
 */
async function ensureTag(label: string): Promise<number> {
  const supabase = await createClient();
  const slug = tagSlug(label);
  if (slug.length < 2) throw new Error("tag is too short");

  const { data: existing } = await supabase
    .from("notes_tags")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: user } = await supabase.auth.getUser();
  const { data: created, error } = await supabase
    .from("notes_tags")
    .insert({ slug, label: label.trim().slice(0, 40), created_by: user.user?.id })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return created.id;
}

/** Every folder-tag association grants joining now — there is no toggle. */
export async function addFolderTag(folderId: string, label: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("notes_folder_tags")
    .upsert({ folder_id: folderId, tag_id: await ensureTag(label), grants_join: true });
  if (error) throw new Error(error.message);
}

export async function removeFolderTag(folderId: string, slug: string): Promise<void> {
  const supabase = await createClient();
  const { data: tag } = await supabase
    .from("notes_tags")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!tag) return;
  const { error } = await supabase
    .from("notes_folder_tags")
    .delete()
    .eq("folder_id", folderId)
    .eq("tag_id", tag.id);
  if (error) throw new Error(error.message);
}

/* --- topics ---------------------------------------------------------------- */

/**
 * Topics the caller created. notes_tags is a shared vocabulary with a broad
 * SELECT policy (`true`), so this needs the created_by filter to mean
 * anything — it is not RLS restricting the result.
 */
export async function myCreatedTags(): Promise<UserTag[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return [];
  const { data, error } = await supabase
    .from("notes_tags")
    .select("slug, label")
    .eq("created_by", user.user.id)
    .order("label");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({ slug: row.slug, label: row.label }));
}

/* --- follows: request/accept, and the gate for tagging and inviting ------- */

/**
 * Ask to follow someone. Writes the caller's own row as `pending` — the RLS
 * `WITH CHECK` pins that, so this can never pre-accept itself — and the
 * followee answers later with `respondFollow`. Re-following an edge that is
 * already pending or accepted is a silent no-op, not an error: the primary
 * key conflict is swallowed rather than resetting anything.
 */
export async function follow(username: string): Promise<void> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error("sign in required");

  const { data: target } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", username.trim())
    .maybeSingle();
  if (!target) throw new Error("no such user");
  // The table's CHECK refuses this too, but as driver text that reaches the
  // caller as a bare 500. Say what happened instead.
  if (target.id === user.user.id) throw new Error("you cannot follow yourself");

  const { error } = await supabase
    .from("notes_follows")
    .upsert(
      { follower_id: user.user.id, followee_id: target.id },
      { ignoreDuplicates: true }
    );
  if (error) throw new Error(error.message);
}

/**
 * Break a follow edge, at any status. RLS lets either side delete it, so this
 * covers unfollowing, withdrawing a still-pending request, and a followee
 * removing a follower (pending or accepted) who may then no longer tag them.
 */
export async function unfollow(userId: string, direction: "following" | "followers"): Promise<void> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error("sign in required");

  const match =
    direction === "following"
      ? { follower_id: user.user.id, followee_id: userId }
      : { follower_id: userId, followee_id: user.user.id };
  const { error } = await supabase.from("notes_follows").delete().match(match);
  if (error) throw new Error(error.message);
}

/** Answer an incoming follow request, as the followee. */
export const respondFollow = (followerId: string, accept: boolean) =>
  rpc("notes_respond_follow", { p_follower: followerId, p_accept: accept }) as Promise<string>;

/**
 * The caller's incoming, still-pending follow requests — the ones
 * `respondFollow` can answer. RLS already scopes `notes_follows` to rows the
 * caller is a side of, so this needs no owner filter beyond `followee_id`.
 */
export async function myFollowRequests(): Promise<FollowRequest[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return [];

  const { data, error } = await supabase
    .from("notes_follows")
    .select("follower_id, created_at, profiles!notes_follows_follower_id_fkey!inner(username, avatar_url)")
    .eq("followee_id", user.user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const avatars = await resolveAvatarUrls(supabase, rows.map((row: any) => row.profiles?.avatar_url));
  return rows.map((row: any) => ({
    followerId: row.follower_id,
    username: row.profiles?.username ?? "unknown",
    avatarUrl: avatars.get(row.profiles?.avatar_url ?? "") ?? null,
    createdAt: row.created_at,
  }));
}

/**
 * One page of the caller's *accepted* follow edges in a single direction —
 * the real, mutually-established network `notes_follows_me` also reads.
 * Outgoing pending requests (the caller followed someone who has not
 * answered) are deliberately excluded, not just this direction's incoming
 * ones. Paged and searchable for the same reason members are: the UI shows a
 * handful, and the list has no natural ceiling.
 */
export async function listFollows(
  direction: "following" | "followers",
  opts: { q?: string; limit?: number; offset?: number } = {}
): Promise<{ people: FollowEdge[]; total: number }> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { people: [], total: 0 };

  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const offset = Math.max(opts.offset ?? 0, 0);
  const q = opts.q?.trim();

  // The joined profile is the other person: the followee when listing who the
  // caller follows, the follower when listing who follows them.
  const join =
    direction === "following"
      ? "profiles!notes_follows_followee_id_fkey!inner(id, username, avatar_url)"
      : "profiles!notes_follows_follower_id_fkey!inner(id, username, avatar_url)";
  const own = direction === "following" ? "follower_id" : "followee_id";

  let query = supabase
    .from("notes_follows")
    .select(`created_at, ${join}`, { count: "exact" })
    .eq(own, user.user.id)
    .eq("status", "accepted");
  if (q) query = query.ilike("profiles.username", `%${q}%`);

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const avatars = await resolveAvatarUrls(supabase, rows.map((row: any) => row.profiles?.avatar_url));
  return {
    people: rows.map((row: any) => ({
      userId: row.profiles?.id ?? "",
      username: row.profiles?.username ?? "unknown",
      avatarUrl: avatars.get(row.profiles?.avatar_url ?? "") ?? null,
      since: row.created_at,
    })),
    total: count ?? 0,
  };
}

/* --- social: onboarding, feed, profiles ------------------------------------ */

/**
 * Put a new account into every featured folder and follow their owners. Once
 * per account — the RPC records that it ran, so leaving a featured folder is
 * permanent. Returns how many folders were joined (0 on every later call).
 */
export const onboard = () => rpc("notes_onboard", {}) as Promise<number>;

/** A page of the home feed, newest first. Pass the oldest `at` as `before`. */
export async function feed(opts: { before?: string; limit?: number } = {}): Promise<FeedItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notes_feed", {
    p_before: opts.before ?? null,
    p_limit: opts.limit ?? 20,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  const avatars = await resolveAvatarUrls(supabase, rows.map((r) => r.owner_avatar));
  return rows.map((r): FeedItem => {
    const ownerAvatar = avatars.get(r.owner_avatar ?? "") ?? null;
    return r.item_kind === "doc"
      ? {
          kind: "doc",
          at: r.at,
          docKind: r.doc_kind,
          docKey: r.doc_key,
          title: r.doc_title,
          overview: r.doc_overview ?? null,
          folderSlug: r.folder_slug,
          folderName: r.folder_name,
          ownerUsername: r.owner_username,
          ownerAvatar,
        }
      : {
          kind: "folder",
          at: r.at,
          folderSlug: r.folder_slug,
          folderName: r.folder_name,
          description: r.folder_description,
          ownerUsername: r.owner_username,
          ownerAvatar,
        };
  });
}

/** A person's header, or null when no such username exists. */
export async function profile(username: string): Promise<Profile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notes_profile", { p_username: username });
  if (error) throw new Error(error.message);
  const row = (data as any[])?.[0];
  if (!row) return null;
  const avatars = await resolveAvatarUrls(supabase, [row.avatar_url]);
  return {
    userId: row.user_id,
    username: row.username,
    avatarUrl: avatars.get(row.avatar_url ?? "") ?? null,
    followers: Number(row.followers ?? 0),
    following: Number(row.following ?? 0),
    publicFolders: Number(row.public_folders ?? 0),
    followState: row.follow_state,
  };
}

/** The folders of theirs the caller can see — public ones, plus private ones they're in. */
export async function userFolders(
  username: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<FolderSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notes_user_folders", {
    p_username: username,
    p_limit: opts.limit ?? 20,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw new Error(error.message);
  return toSummaries(supabase, data ?? []);
}

export const transferOwnership = (folderId: string, userId: string) =>
  rpc("notes_transfer_ownership", { p_folder: folderId, p_user: userId }) as Promise<string>;

