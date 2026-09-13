// Shapes returned by the collaboration layer. Mirrors the SQL in
// supabase/migrations/ — see docs/collaboration.md for the model.

export type FolderRole = "owner" | "editor" | "viewer";
export type Visibility = "public" | "private";

export interface FolderSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: Visibility;
  ownerId: string;
  ownerUsername: string;
  ownerAvatar: string | null;
  tags: string[];
  /** Inert mirror of `tags` since 0026; kept for the RPC row shape. */
  joinTags: string[];
  memberCount: number;
  documentCount: number;
  /** The caller's role, or null when they are not a member. */
  myRole: FolderRole | null;
  createdAt: string;
}

/**
 * Same shape as a summary. Discoverability and join policy used to live here;
 * both are gone — a public folder is listed, a private one is not, and the one
 * way in is a request the owner approves.
 */
export type FolderDetail = FolderSummary;

export interface UserTag {
  slug: string;
  label: string;
}

/**
 * One direction of a follow edge that has been accepted by both sides. Its
 * only power is that it lets the followee tag or invite the follower.
 */
export interface FollowEdge {
  userId: string;
  username: string;
  avatarUrl: string | null;
  since: string;
}

/**
 * An incoming follow request, still awaiting the caller's answer as the
 * followee. Answered through `respondFollow` — accepting turns it into a
 * `FollowEdge`, declining deletes it outright.
 */
export interface FollowRequest {
  followerId: string;
  username: string;
  avatarUrl: string | null;
  createdAt: string;
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
  inviterAvatarUrl: string | null;
  inviteeUsername: string;
  inviteeAvatarUrl: string | null;
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
}

/** Permission helpers. Cosmetic only — the database is what enforces these. */
export const canWrite = (role: FolderRole | null) => role === "owner" || role === "editor";
export const canManage = (role: FolderRole | null) => role === "owner";

/**
 * One row of the home feed. Only ever something the caller can already read:
 * a document in a folder they are a member of, or a public folder created by
 * someone they follow (metadata only). See notes_feed in 0029.
 */
export type FeedItem =
  | {
      kind: "doc";
      at: string;
      docKind: "lesson" | "quiz";
      docKey: string;
      title: string;
      /** The lesson's Overview section as HTML, or null (quizzes, no section). */
      overview: string | null;
      folderSlug: string;
      folderName: string;
      ownerUsername: string;
      ownerAvatar: string | null;
    }
  | {
      kind: "folder";
      at: string;
      folderSlug: string;
      folderName: string;
      description: string | null;
      ownerUsername: string;
      ownerAvatar: string | null;
    };

export type FollowState = "none" | "pending" | "accepted" | "self";

/** A person's profile header. Counts are accepted follows only. */
export interface Profile {
  userId: string;
  username: string;
  avatarUrl: string | null;
  followers: number;
  following: number;
  publicFolders: number;
  followState: FollowState;
}
