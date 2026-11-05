import { NextRequest, NextResponse } from "next/server";
import { VERIFIED_USER_HEADER } from "@/middleware";
import { AiError } from "@/lib/ai/core";
import { listModels } from "@/lib/ai/models";
import { isWebService } from "@/lib/ai/services";
import { useKey, VaultError } from "@/lib/ai/vault";

// The models the reader's saved key can use. The key is decrypted here, used
// for this one request to the service, and never leaves the server.
export async function GET(req: NextRequest) {
  const owner = req.headers.get(VERIFIED_USER_HEADER);
  if (!owner) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const service = req.nextUrl.searchParams.get("service");
  if (!isWebService(service)) return NextResponse.json({ error: "invalid service" }, { status: 400 });
  let saved;
  try {
    saved = await useKey(owner, service);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VaultError ? err.message : "the saved key can't be read" }, { status: 409 });
  }
  if (!saved) return NextResponse.json({ error: "no key saved for that service" }, { status: 404 });
  try {
    const models = (await listModels(service, saved.key, AbortSignal.timeout(15_000))).sort();
    return NextResponse.json({ models, model: saved.model }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AiError && err.kind === "auth") return NextResponse.json({ error: "the saved key was rejected" }, { status: 401 });
    return NextResponse.json({ error: "couldn't reach the service" }, { status: 502 });
  }
}
