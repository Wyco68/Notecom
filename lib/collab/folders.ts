// Collaboration data layer: typed wrappers over the RPCs and RLS-guarded
// selects defined in supabase/migrations/.
//
// There is no authorization logic here on purpose. Every function below is a
// thin call the database is free to refuse — a returned empty list means RLS
// hid the rows, and a thrown error usually means an RPC rejected the caller.
// Adding a permission check here would create a second, weaker answer to a
// question Postgres has already answered.

import { createClient } from "@/lib/supabase/server";
import type {
  FolderDetail,
  FolderRole,
  FolderSummary,
  FolderTag,
  Invitation,
  JoinPolicy,
  JoinRequest,
  Member,
  Visibility,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

function toSummary(row: any): FolderSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    joinPolicy: row.join_policy,
    ownerId: row.owner_id,
    ownerUsername: row.owner_username,
    ownerAvatar: row.owner_avatar ?? null,
    tags: row.tags ?? [],
    joinTags: row.join_tags ?? [],
    memberCount: Number(row.member_count ?? 0),
    documentCount: Number(row.document_count ?? 0),
    myRole: (row.my_role as FolderRole) ?? null,
    createdAt: row.created_at,
  };
}

/** Discovery. The RPC itself hides non-discoverable folders from non-members. */
export async function searchFolders(
  q?: string,
  tags?: string[],
  limit = 20,
  offset = 0
): Promise<FolderSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notes_search_folders", {
    p_q: q?.trim() || null,
    p_tags: tags?.length ? tags : null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toSummary);
}

/** Folders the caller owns or belongs to, for their own sidebar/dashboard. */
export async function myFolders(): Promise<FolderSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notes_my_folders");
  if (error) throw new Error(error.message);
  return (data ?? []).map(toSummary);
}

/**
 * One folder by slug. Slugs are unique per owner, not globally, so an owner
 * username is required to disambiguate when the caller is not a member.
 */
export async function getFolder(
  slug: string,
  ownerUsername?: string
): Promise<FolderDetail | null> {
  const supabase = await createClient();
  const matches = (await searchFolders(slug, undefined, 50, 0)).filter(
    (f) => f.slug === slug && (!ownerUsername || f.ownerUsername === ownerUsername)
  );
  // Prefer a folder the caller belongs to: searching by slug can legitimately
  // match someone else's public folder of the same name.
  const hit = matches.find((f) => f.myRole) ?? matches[0];
  if (!hit) return null;

  const { data } = await supabase
    .from("notes_folders")
    .select("discoverable")
    .eq("id", hit.id)
    .maybeSingle();
  return { ...hit, discoverable: !!data?.discoverable };
}

export async function listMembers(folderId: string): Promise<Member[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes_folder_members")
    .select("user_id, role, joined_at, profiles(username, avatar_url)")
    .eq("folder_id", folderId)
    .order("joined_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({
    userId: row.user_id,
    username: row.profiles?.username ?? "unknown",
    avatarUrl: row.profiles?.avatar_url ?? null,
    role: row.role,
    joinedAt: row.joined_at,
  }));
}

export async function listFolderTags(folderId: string): Promise<FolderTag[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes_folder_tags")
    .select("grants_join, notes_tags(slug, label)")
    .eq("folder_id", folderId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({
    slug: row.notes_tags?.slug ?? "",
    label: row.notes_tags?.label ?? "",
    grantsJoin: !!row.grants_join,
  }));
}

/** Pending invitations addressed to the caller. */
export async function myInvitations(): Promise<Invitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes_folder_invitations")
    .select(
      "id, folder_id, role, status, created_at, " +
        "notes_folders(name, slug), " +
        "inviter:profiles!notes_folder_invitations_inviter_id_fkey(username), " +
        "invitee:profiles!notes_folder_invitations_invitee_id_fkey(username)"
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toInvitation);
}

/** Invitations issued for one folder — visible to managers only, via RLS. */
export async function listFolderInvitations(folderId: string): Promise<Invitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes_folder_invitations")
    .select(
      "id, folder_id, role, status, created_at, " +
        "notes_folders(name, slug), " +
        "inviter:profiles!notes_folder_invitations_inviter_id_fkey(username), " +
        "invitee:profiles!notes_folder_invitations_invitee_id_fkey(username)"
    )
    .eq("folder_id", folderId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toInvitation);
}

function toInvitation(row: any): Invitation {
  return {
    id: row.id,
    folderId: row.folder_id,
    folderName: row.notes_folders?.name ?? "",
    folderSlug: row.notes_folders?.slug ?? "",
    role: row.role,
    status: row.status,
    inviterUsername: row.inviter?.username ?? "someone",
    inviteeUsername: row.invitee?.username ?? "",
    createdAt: row.created_at,
  };
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
  return (data ?? []).map((row: any) => ({
    id: row.id,
    folderId: row.folder_id,
    folderName: row.notes_folders?.name ?? "",
    userId: row.user_id,
    username: row.profiles?.username ?? "unknown",
    avatarUrl: row.profiles?.avatar_url ?? null,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
  }));
}

/* --- actions: every one is an RPC that re-checks authorization itself --- */

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

export const inviteMember = (folderId: string, username: string, role: FolderRole) =>
  rpc("notes_invite_member", { p_folder: folderId, p_username: username, p_role: role });

export const respondInvitation = (invitationId: string, accept: boolean) =>
  rpc("notes_respond_invitation", { p_invitation: invitationId, p_accept: accept });

export const requestJoin = (folderId: string, message?: string) =>
  rpc("notes_request_join", { p_folder: folderId, p_message: message ?? null }) as Promise<string>;

export const joinByTag = (folderId: string, tag: string) =>
  rpc("notes_join_by_tag", { p_folder: folderId, p_tag: tag }) as Promise<string>;

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
    discoverable?: boolean;
    joinPolicy?: JoinPolicy;
    description?: string | null;
  }
): Promise<void> {
  const supabase = await createClient();
  const row: Record<string, unknown> = {};
  if (patch.visibility !== undefined) row.visibility = patch.visibility;
  if (patch.discoverable !== undefined) row.discoverable = patch.discoverable;
  if (patch.joinPolicy !== undefined) row.join_policy = patch.joinPolicy;
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

export async function addFolderTag(
  folderId: string,
  label: string,
  grantsJoin: boolean
): Promise<void> {
  const supabase = await createClient();
  const slug = tagSlug(label);
  if (slug.length < 2) throw new Error("tag is too short");

  const { data: user } = await supabase.auth.getUser();
  // The tag vocabulary is shared, so an existing slug is reused rather than
  // duplicated; only a genuinely new tag is inserted.
  const { data: existing } = await supabase
    .from("notes_tags")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  let tagId = existing?.id;
  if (!tagId) {
    const { data: created, error } = await supabase
      .from("notes_tags")
      .insert({ slug, label: label.trim().slice(0, 40), created_by: user.user?.id })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    tagId = created.id;
  }

  const { error } = await supabase
    .from("notes_folder_tags")
    .upsert({ folder_id: folderId, tag_id: tagId, grants_join: grantsJoin });
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

/** Every tag in use, for the discovery filter chips. */
export async function listTags(): Promise<{ slug: string; label: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes_tags")
    .select("slug, label")
    .order("slug")
    .limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}
