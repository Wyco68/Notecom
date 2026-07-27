// Shapes returned by the collaboration layer. Mirrors the SQL in
// supabase/migrations/ — see docs/collaboration.md for the model.

export type FolderRole = "owner" | "editor" | "viewer";
export type Visibility = "public" | "private";
export type JoinPolicy = "open" | "request" | "invite_only";

export interface FolderSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: Visibility;
  joinPolicy: JoinPolicy;
  ownerId: string;
  ownerUsername: string;
  ownerAvatar: string | null;
  tags: string[];
  /** Tags that let anyone who found the folder through them join outright. */
  joinTags: string[];
  memberCount: number;
  documentCount: number;
  /** The caller's role, or null when they are not a member. */
  myRole: FolderRole | null;
  createdAt: string;
}

export interface FolderDetail extends FolderSummary {
  discoverable: boolean;
}

export interface UserTag {
  slug: string;
  label: string;
}

/**
 * A tag someone has offered the caller. Holding the tag is what grants access
 * to folders carrying it, so it only takes effect once accepted — a pending
 * grant confers nothing.
 */
export interface TagGrant {
  id: string;
  slug: string;
  label: string;
  granterUsername: string;
  createdAt: string;
}

/** A tag the caller has given someone, and can take back. */
export interface GrantedTag {
  username: string;
  slug: string;
  label: string;
  grantedAt: string;
}

/**
 * One direction of a follow. Following is one-sided and needs no approval; its
 * only power is that it lets the followee tag or invite the follower.
 */
export interface FollowEdge {
  userId: string;
  username: string;
  avatarUrl: string | null;
  since: string;
}

export interface Member {
  userId: string;
  username: string;
  avatarUrl: string | null;
  role: FolderRole;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  folderId: string;
  folderName: string;
  folderSlug: string;
  role: FolderRole;
  status: "pending" | "accepted" | "declined" | "revoked";
  inviterUsername: string;
  inviteeUsername: string;
  createdAt: string;
}

export interface JoinRequest {
  id: string;
  folderId: string;
  folderName: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  message: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export interface FolderTag {
  slug: string;
  label: string;
  grantsJoin: boolean;
}

/** Permission helpers. Cosmetic only — the database is what enforces these. */
export const canWrite = (role: FolderRole | null) => role === "owner" || role === "editor";
export const canManage = (role: FolderRole | null) => role === "owner";
