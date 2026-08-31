import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NotificationsPanel from "@/components/collab/NotificationsPanel";
import NotificationsProvider from "@/components/collab/NotificationsProvider";
import { collabEnabled } from "@/lib/supabase/server";

// The standalone route. Notifications normally open inside the workspace's
// content column (AppShell keeps the sidebar, the open document and any
// running generation alive behind it); this page is what a deep link or an
// auth `?next=/notifications` lands on, and it renders the same panel without
// a close button — same pattern as /discover and /people.
//
// The provider is mounted here rather than in the layout because it is what
// owns the fetch: the bell and the panel must read one copy of the list, and
// outside the workspace this page is the only reader.

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  // Without collaboration configured the panel renders nothing, and middleware
  // doesn't gate this route either — the page would be a blank <main> with no
  // heading and no explanation. There is no such thing as notifications on
  // this build, so say that in the one way the app already has.
  if (!collabEnabled()) notFound();

  return (
    <main id="main" tabIndex={-1}>
      <NotificationsProvider>
        <NotificationsPanel />
      </NotificationsProvider>
    </main>
  );
}
