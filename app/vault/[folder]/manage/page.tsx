"use client";

import { use } from "react";
import FolderManagePanel from "@/components/collab/FolderManagePanel";

// The standalone sharing console. The workspace normally shows this same panel
// in its content column (AppShell, from the sidebar's share icon) rather than
// navigating away, so this route exists for the paths that genuinely are a
// navigation: a deep link, and the `?next=` an auth redirect returns to.

export default function ManageFolderPage({
  params,
}: {
  params: Promise<{ folder: string }>;
}) {
  const { folder } = use(params);
  return (
    <main>
      <FolderManagePanel slug={folder} />
    </main>
  );
}
