// Cookie-bound Supabase client for server code (route handlers, server
// components). Anon key only — this app holds no service-role key anywhere, so
// every query runs as the signed-in user and Row Level Security decides what
// comes back. See docs/collaboration.md.
//
// Client factories only: no queries, no business logic. Those live in
// lib/collab/*.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function collabEnabled(): boolean {
  return !!URL && !!ANON_KEY;
}

export async function createClient() {
  if (!URL || !ANON_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set");
  }
  const store = await cookies();
  return createServerClient(URL, ANON_KEY, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(list) {
        // Server components can't set cookies; the middleware refreshes the
        // session instead, so swallowing here is the documented pattern.
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {}
      },
    },
  });
}

/** The signed-in user, or null. Never throws — callers branch on null. */
export async function currentUser() {
  if (!collabEnabled()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
