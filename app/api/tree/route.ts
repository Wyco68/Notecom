import { NextResponse } from "next/server";
import { isRemoteVault, listTree } from "@/lib/vault/helper";
import { triggerReindex } from "@/lib/search/indexd";

export async function GET() {
  // Tree fetches happen exactly when vault content may have changed (page
  // load, window focus, manual refresh) — cheapest possible hook to keep
  // the search index current. Hash-based scan, near-free when unchanged.
  // The remote deployments have no indexd, so there's nothing to reindex.
  if (!isRemoteVault()) triggerReindex();
  // Runtime read-only signal so the client hides write/chat controls even if
  // the build-time NEXT_PUBLIC_VAULT_SOURCE was missing (e.g. a Vercel build
  // without it). readOnly gates writes; remote also disables chat. Sent on
  // the error path too, so a momentarily-unreachable backend still can't leak
  // the write buttons on a read-only deployment.
  const flags = {
    readOnly: isRemoteVault() || process.env.READ_ONLY === "1",
    remote: isRemoteVault(),
  };
  try {
    const tree = await listTree();
    return NextResponse.json({ ...tree, ...flags });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, ...flags }, { status: 502 });
  }
}
