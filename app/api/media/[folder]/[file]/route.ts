import { NextRequest, NextResponse } from "next/server";
import { readMedia } from "@/lib/vault/store";

// A slide picture from a lesson or cheatsheet, streamed as the reader: the
// bucket's policies decide, so a picture is visible exactly where its folder
// is. Same "not found" for missing and forbidden, like every folder lookup.
// The name is the picture's own hash, so the bytes behind a URL never change
// and the browser may keep them for good.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ folder: string; file: string }> }) {
  const { folder, file } = await params;
  const media = await readMedia(`/api/media/${folder}/${file}`);
  if (!media) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(media.data), {
    headers: {
      "Content-Type": media.type,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
