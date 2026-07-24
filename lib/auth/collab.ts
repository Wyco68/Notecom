// Thin client for /api/auth/collab. The security lives on the server (see the
// route): the browser only drives a two-step flow — password/email → 6-digit
// code — and never holds a session until the code is verified.

export type CollabAction =
  | "signup"
  | "password"
  | "verify"
  | "reset"
  | "reset-verify";

export async function collabAuth(
  action: CollabAction,
  payload: Record<string, unknown>
): Promise<void> {
  const res = await fetch("/api/auth/collab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `request failed (${res.status})`);
  }
}

/** A relative next-path is safe to redirect to; anything else falls back to
 *  the vault, so a crafted `?next=` can't become an open redirect. */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") ? next : "/vault";
}
