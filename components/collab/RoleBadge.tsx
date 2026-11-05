"use client";

import type { FolderRole } from "@/lib/collab/types";

// Colours are fixed per role in docs/ui-guidelines.md so a badge means the
// same thing everywhere it appears.
const STYLES: Record<FolderRole, string> = {
  owner: "border-accent/40 text-accent",
  editor: "border-line text-ink-2",
  viewer: "border-line text-muted",
};

export default function RoleBadge({ role }: { role: FolderRole | null }) {
  if (!role) return null;
  return (
    <span className={`ui-badge capitalize ${STYLES[role]}`}>
      {role}
    </span>
  );
}
