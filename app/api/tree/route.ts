import { NextResponse } from "next/server";
import { listTree } from "@/lib/vault/helper";
import { importVault } from "@/lib/vault/import";
import { reindexStale } from "@/lib/vault/store";

export async function GET() {
  // Tree fetches happen exactly when content may have changed (page load,
  // window focus, manual refresh), which makes this the cheapest hook for the
  // two housekeeping passes:
  //
  //   1. ingest Claude-authored vault files, so a lesson generated a moment ago
  //      is present in this very response;
  //   2. re-chunk anything whose search index is stale — typically a document
  //      written by another device, which never passed through this app.
  //
  // Both are best-effort: neither may take the tree down with it, and both are
  // near-free when there is nothing to do.
  await importVault().catch(() => {});
  await reindexStale().catch(() => {});
  try {
    return NextResponse.json(await listTree());
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
