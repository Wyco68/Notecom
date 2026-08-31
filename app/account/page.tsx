import type { Metadata } from "next";
import AccountPanel from "@/components/account/AccountPanel";

export const metadata: Metadata = { title: "Account" };

// The standalone account route. The workspace normally shows this same editor
// in its content column (AppShell) rather than navigating away, so this page
// exists for the paths that genuinely are a navigation: a deep link, and the
// `?next=/account` the auth flow returns to.

export default function AccountPage() {
  return (
    <main id="main" tabIndex={-1}>
      <AccountPanel />
    </main>
  );
}
