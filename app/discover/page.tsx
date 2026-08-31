import type { Metadata } from "next";
import DiscoverPanel from "@/components/collab/DiscoverPanel";

export const metadata: Metadata = { title: "Discover folders" };

// The standalone route. Discovery normally opens inside the workspace's content
// column (AppShell keeps the sidebar, the open document and any running
// generation alive behind it); this page is what a deep link or an auth
// `?next=/discover` lands on, and it renders the same panel without a close
// button.
export default function DiscoverPage() {
  return (
    <main id="main" tabIndex={-1}>
      <DiscoverPanel />
    </main>
  );
}
