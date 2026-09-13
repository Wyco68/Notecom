import { redirect } from "next/navigation";
import { collabEnabled, currentUser } from "@/lib/supabase/server";

// The front door. Notes need an account, so a signed-out visitor lands on the
// sign-in page rather than on a vault they cannot read.
//
// One exception comes first: a `?code=` here is a password-recovery link that
// Supabase sent to the Site URL instead of /auth/callback. It does that
// whenever the requested redirect isn't on the project's Redirect URLs
// allowlist, and redirecting a signed-out visitor to sign-in used to throw the
// code away — the reset link "just went to the login page". Recovery is the
// app's only link-based flow (sign-in and sign-up use typed codes), so the
// code is handed to the callback with the reset page as its destination.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const code = typeof params.code === "string" ? params.code : null;
  if (code) {
    const to = new URLSearchParams({ code, next: "/auth/reset?stage=set" });
    redirect(`/auth/callback?${to}`);
  }

  if (collabEnabled() && !(await currentUser())) {
    redirect("/auth/sign-in?next=/vault");
  }
  redirect("/vault");
}
