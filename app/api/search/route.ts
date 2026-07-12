import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/search/indexd";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "missing q" }, { status: 400 });
  }
  const folder = req.nextUrl.searchParams.get("folder") ?? undefined;
  const kind = req.nextUrl.searchParams.get("kind") ?? undefined;
  const limit = Number(req.nextUrl.searchParams.get("limit")) || undefined;
  try {
    // Remote deployments have no indexd — serve from the prebuilt keyword
    // index (GCS reads it from the bucket, the Worker serves it from KV).
    if (process.env.VAULT_SOURCE === "gcs") {
      const { gcsSearch } = await import("@/lib/vault/gcs");
      return NextResponse.json(await gcsSearch(q, limit));
    }
    if (process.env.VAULT_SOURCE === "worker") {
      const { workerSearch } = await import("@/lib/vault/worker");
      return NextResponse.json(await workerSearch(q, limit));
    }
    const data = await search({ q, folder, kind, limit });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
