// Browser Supabase client. Anon key only — it is a publishable key and is
// meant to reach the browser; every table it can touch is guarded by RLS.
//
// Used for auth flows (sign in, sign out, session) only. Collaboration reads
// and writes go through /api/collab/* so the server holds one consistent
// error shape, matching the rest of the app's routes.

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set");
  }
  return createBrowserClient(url, key);
}
