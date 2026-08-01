import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  AVATAR_BUCKET,
  AVATAR_MAX_BYTES,
  AVATAR_TYPES,
  avatarObjectPath,
  resolveAvatarUrl,
} from "@/lib/collab/avatar";
import { errorResponse, isResponse, requireUser } from "../../route-helpers";

// The caller's profile photo: upload (POST, multipart) and remove (DELETE).
//
// Kept off /api/collab/me/profile because this one carries a file, not JSON.
// The upload runs through the caller's own Supabase session, so the Storage
// policies on `profile-avatars` are the boundary — they pin every object to a
// `{user_id}/…` prefix owned by `auth.uid()`. The size and type checks below are
// there to fail fast with a readable message, not to be the protection.

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "no file uploaded" }, { status: 400 });
    }

    const extension = AVATAR_TYPES[file.type];
    if (!extension) {
      return NextResponse.json(
        { error: "invalid image: use a JPEG, PNG or WebP file" },
        { status: 400 }
      );
    }
    if (file.size > AVATAR_MAX_BYTES) {
      return NextResponse.json(
        { error: `invalid image: keep it under ${AVATAR_MAX_BYTES / (1024 * 1024)} MB` },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const path = avatarObjectPath(user.userId, extension);

    // One object per user, overwritten in place: `upsert` keeps the row's path
    // stable so nothing has to clean up a previous file. A change of format is
    // the exception — the old extension would linger — so those are removed
    // after the new object lands.
    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: true });
    if (uploadError) throw new Error(uploadError.message);

    const stale = Object.values(AVATAR_TYPES)
      .filter((ext) => ext !== extension)
      .map((ext) => avatarObjectPath(user.userId, ext));
    await supabase.storage.from(AVATAR_BUCKET).remove(stale);

    // The row stores the path, never a URL: the bucket is private, so a URL
    // would expire while the row would not.
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: path })
      .eq("id", user.userId);
    if (error) throw new Error(error.message);

    return NextResponse.json({ avatarUrl: await resolveAvatarUrl(supabase, path) });
  } catch (err: any) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  try {
    const supabase = await createClient();
    // Clear the row first: a profile pointing at a deleted object renders as a
    // broken image, while an orphaned object renders as nothing at all.
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: null })
      .eq("id", user.userId);
    if (error) throw new Error(error.message);

    await supabase.storage
      .from(AVATAR_BUCKET)
      .remove(Object.values(AVATAR_TYPES).map((ext) => avatarObjectPath(user.userId, ext)));

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorResponse(err);
  }
}
