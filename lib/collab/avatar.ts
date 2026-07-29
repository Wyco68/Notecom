// Profile photos. The picture itself lives in the `profile-avatars` Storage
// bucket; `profiles.avatar_url` holds only the object path
// (`{user_id}/avatar.{ext}`), which a database trigger validates — a row can
// never point at another user's object.
//
// The bucket is private, so a stored path is not a usable `src`. Reads go
// through a short-lived signed URL minted with the caller's own JWT, which is
// why this module takes a Supabase client rather than constructing one: the
// same RLS that guards the row guards the file.
//
// Historical rows may still hold an absolute `http(s)` URL (the shared
// BookCommunity identity pool allowed one). Those are passed through unchanged
// — this app no longer writes them.

import type { SupabaseClient } from "@supabase/supabase-js";

export const AVATAR_BUCKET = "profile-avatars";

/** How long a minted avatar URL stays valid. Long enough for a page session. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** 2 MB. A profile thumbnail has no reason to be larger. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The extensions the trigger accepts, keyed by the MIME type the browser
 * reports. Both halves matter: the MIME type is what we validate the upload
 * against, the extension is what the object path must end in.
 */
export const AVATAR_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const AVATAR_ACCEPT = Object.keys(AVATAR_TYPES).join(",");

/** The one path a given user's avatar is allowed to occupy. */
export function avatarObjectPath(userId: string, extension: string): string {
  return `${userId}/avatar.${extension}`;
}

const isAbsolute = (value: string) => /^https?:\/\//i.test(value);

/**
 * Turn a stored `avatar_url` into something an `<img>` can load, or null when
 * there is no avatar or the object has gone missing. Never throws: a broken
 * avatar must not take down the profile it belongs to.
 */
export async function resolveAvatarUrl(
  supabase: SupabaseClient,
  stored: string | null | undefined
): Promise<string | null> {
  if (!stored) return null;
  if (isAbsolute(stored)) return stored;
  try {
    const { data, error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(stored, SIGNED_URL_TTL_SECONDS);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}
