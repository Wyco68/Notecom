"use client";

import type { FolderRole } from "@/lib/collab/types";

// Colours are fixed per role in docs/ui-guidelines.md so a badge means the
// same thing everywhere it appears.
const STYLES: Record<FolderRole, string> = {
  owner: "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-300",
  editor: "bg-blue-500/15 text-blue-600 border-blue-500/30 dark:text-blue-300",
  viewer: "bg-gray-500/15 text-gray-500 border-black/10 dark:border-white/10 dark:text-gray-400",
};

export default function RoleBadge({ role }: { role: FolderRole | null }) {
  if (!role) return null;
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${STYLES[role]}`}>
      {role}
    </span>
  );
}
