import { NextResponse } from "next/server";
import { listFolders } from "@/lib/vault/helper";
import { importVault } from "@/lib/vault/import";
import { reindexStale } from "@/lib/vault/store";

// GET is the sidebar's first paint and must stay cheap: folder names only, one
// indexed query. A folder's documents arrive from /api/folders/[name] when the
// reader opens it.
//
// The two housekeeping passes used to run here, on every page load, window
// focus and refresh — an ingest of the whole vault/ directory and a scan of
// every document's chunk version, all of it ahead of the first byte the reader
// was waiting for. They are POST now: the client fires one after the tree is on
// screen, and again when a generation run finishes, which is when their result
// can actually differ.
export async function GET() {
  try {
    return NextResponse.json(await listFolders());
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

// Ingest Claude-authored vault files, then re-chunk anything whose search index
// is stale — typically a document written by another device, which never passed
// through this app.
//
// Both are best-effort and independent: a failing import must not cost the
// caller the reindex, and neither may fail the request. The counts are what
// tell the client whether re-reading the tree is worth it.
export async function POST() {
  const imported = await importVault().catch(() => null);
  const reindexed = await reindexStale().catch(() => 0);
  return NextResponse.json({
    imported: imported?.imported ?? 0,
    skipped: imported?.skipped ?? 0,
    errors: imported?.errors ?? 0,
    reindexed,
  });
}
