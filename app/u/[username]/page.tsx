import type { Metadata } from "next";
import ProfilePanel from "@/components/collab/ProfilePanel";

// The standalone profile route: what a shared /u/<name> link or an auth
// `?next=/u/<name>` lands on. The workspace normally opens the same panel in
// its content column instead.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  return { title: decodeURIComponent(username) };
}

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return (
    <main id="main" tabIndex={-1}>
      <ProfilePanel username={decodeURIComponent(username)} />
    </main>
  );
}
