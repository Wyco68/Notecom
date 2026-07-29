import { redirect } from "next/navigation";
import { collabEnabled, currentUser } from "@/lib/supabase/server";

// The front door. Notes need an account, so a signed-out visitor lands on the
// sign-in page rather than on a vault they cannot read.
export default async function Home() {
  if (collabEnabled() && !(await currentUser())) {
    redirect("/auth/sign-in?next=/vault");
  }
  redirect("/vault");
}
