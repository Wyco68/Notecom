import { NextResponse } from "next/server";
import { listFolders } from "@/lib/vault/helper";
import { reindexStale } from "@/lib/vault/store";

// GET is the sidebar's first paint and must stay cheap: folder names only, one
// indexed query. A folder's documents arrive from /api/folders/[name] when the
// reader opens it.
//
// The reindex pass used to run here, on every page load, window focus and
// refresh — a scan of every document's chunk version, ahead of the first byte
// the reader was waiting for. It is POST now: the client fires it after the
// tree is on screen, and again when a generation run finishes.
export async function GET() {
  try {
    const res = NextResponse.json(await listFolders());
    // Per-user (RLS-scoped) data — `private` keeps it out of any shared/CDN
    // cache. The focus/visibility auto-check is the caller that actually
    // benefits: it opts into reusing a near-fresh response instead of forcing
    // a Supabase round trip on every alt-tab (see AppShell.tsx's
    // `refreshFolderNames`); every other caller still asks for `no-store`.
    res.headers.set("Cache-Control", "private, max-age=0, stale-while-revalidate=20");
    return res;
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

// Re-chunk anything whose search index is stale — typically a document written
// by another device or an older app version, which never passed through this
// process's saveDoc. Best-effort: it may not fail the request. The count is
// what tells the client whether re-reading the tree is worth it.
export async function POST() {
  const reindexed = await reindexStale().catch(() => 0);
  return NextResponse.json({ reindexed });
}
