"use client";

import { useState } from "react";
import UserIcon from "@/components/icons/UserIcon";

// One identity mark, everywhere a person appears in a list: a signed photo
// when the profile has one, initials when it doesn't, the generic person
// glyph when there isn't even a username yet. `avatarUrl` must already be a
// usable `src` (a signed URL or a historical absolute one) — this component
// never talks to Storage itself, see lib/collab/avatar.ts.
export default function Avatar({
  username,
  avatarUrl,
  size = 7,
}: {
  username: string | null;
  avatarUrl?: string | null;
  /** Tailwind spacing step for both height and width, e.g. 7 → h-7 w-7. */
  size?: 5 | 6 | 7 | 8 | 9 | 10;
}) {
  const dims: Record<number, string> = {
    5: "h-5 w-5",
    6: "h-6 w-6",
    7: "h-7 w-7",
    8: "h-8 w-8",
    9: "h-9 w-9",
    10: "h-10 w-10",
  };
  const textSize = size <= 6 ? "text-[9px]" : size <= 8 ? "text-xs" : "text-sm";
  // Tracks which URL failed rather than a plain boolean, so a prop change to
  // a fresh URL (a re-signed avatar, a different person in a recycled row)
  // gets a real reload instead of staying stuck on the broken-image fallback.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const showImage = !!avatarUrl && avatarUrl !== brokenUrl;

  return (
    <span
      className={`relative ${dims[size]} shrink-0 overflow-hidden rounded-full border border-black/10 bg-black/[0.06] dark:border-white/10 dark:bg-white/10`}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- a signed
        // Storage URL is short-lived and per-request, so next/image's
        // optimiser has nothing stable to cache.
        <img
          src={avatarUrl!}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setBrokenUrl(avatarUrl!)}
        />
      ) : username ? (
        <span
          className={`absolute inset-0 flex items-center justify-center ${textSize} font-medium text-gray-600 dark:text-gray-300`}
        >
          {username.slice(0, 2).toUpperCase()}
        </span>
      ) : (
        <UserIcon className="absolute inset-0 m-auto h-1/2 w-1/2 text-gray-400 dark:text-gray-500" />
      )}
    </span>
  );
}
