import { NextResponse } from "next/server";
import { listTree } from "@/lib/vault/helper";
import { triggerReindex } from "@/lib/search/indexd";

export async function GET() {
  // Tree fetches happen exactly when vault content may have changed (page
  // load, window focus, manual refresh) — cheapest possible hook to keep
  // the search index current. Hash-based scan, near-free when unchanged.
  // The GCS deployment has no indexd, so there's nothing to reindex.
  if (process.env.VAULT_SOURCE !== "gcs") triggerReindex();
  try {
    const tree = await listTree();
    return NextResponse.json(tree);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
