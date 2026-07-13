import { NextResponse } from "next/server";
import { listTree, syncFromVault } from "@/lib/vault/helper";
import { triggerReindex } from "@/lib/search/indexd";

export async function GET() {
  // Tree fetches happen exactly when vault content may have changed (page
  // load, window focus, manual refresh) — cheapest possible hook to keep
  // the search index current. Hash-based scan, near-free when unchanged.
  triggerReindex();
  // Ingest Claude-authored vault files into SQLite before listing, so a
  // just-generated lesson appears in this very response. Best-effort:
  // stored being briefly down must not take the tree with it.
  await syncFromVault().catch(() => {});
  // Runtime read-only signal (READ_ONLY=1 boxes) so the client hides write
  // controls; sent on the error path too so a momentarily-unreachable
  // backend can't leak the write buttons.
  const flags = { readOnly: process.env.READ_ONLY === "1" };
  try {
    const tree = await listTree();
    return NextResponse.json({ ...tree, ...flags });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, ...flags }, { status: 502 });
  }
}
