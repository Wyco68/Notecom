import { NextRequest, NextResponse } from "next/server";
import { VERIFIED_USER_HEADER } from "@/middleware";
import { AiError } from "@/lib/ai/core";
import { listModels, suggestModel } from "@/lib/ai/models";
import { isPlausibleKey, isWebService, MODEL_RE } from "@/lib/ai/services";
import { deleteKey, listKeys, saveKey, setModel, vaultReady } from "@/lib/ai/vault";

// The reader's saved AI keys. A key arrives here once (PUT), is checked
// against its service, encrypted and stored; nothing here ever sends it back —
// GET returns only which services have one and its last four characters.

function notReady() {
  return NextResponse.json({ error: "web generation isn't set up on this server yet" }, { status: 503 });
}

export async function GET(req: NextRequest) {
  if (!req.headers.get(VERIFIED_USER_HEADER)) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  if (!vaultReady()) return NextResponse.json({ keys: [], ready: false });
  return NextResponse.json({ keys: await listKeys(), ready: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  const owner = req.headers.get(VERIFIED_USER_HEADER);
  if (!owner) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  if (!vaultReady()) return notReady();
  const body = await req.json().catch(() => null);
  const service = body?.service;
  const key = typeof body?.key === "string" ? body.key.trim() : body?.key;
  if (!isWebService(service) || !isPlausibleKey(key)) {
    return NextResponse.json({ error: "that doesn't look like an API key" }, { status: 400 });
  }
  // The model list is the key check: a key its service refuses is never kept.
  let models: string[];
  try {
    models = (await listModels(service, key, AbortSignal.timeout(15_000))).sort();
  } catch (err) {
    if (err instanceof AiError && err.kind === "auth") return NextResponse.json({ error: "that key was rejected" }, { status: 401 });
    if (err instanceof AiError && err.kind === "rate") return NextResponse.json({ error: "rate limited — try again in a minute" }, { status: 429 });
    return NextResponse.json({ error: "couldn't reach the service" }, { status: 502 });
  }
  const model = suggestModel(service, models) || null;
  await saveKey(owner, service, key, model);
  return NextResponse.json({ ok: true, models, model, hint: key.slice(-4) });
}

export async function PATCH(req: NextRequest) {
  const owner = req.headers.get(VERIFIED_USER_HEADER);
  if (!owner) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!isWebService(body?.service) || typeof body?.model !== "string" || !MODEL_RE.test(body.model)) {
    return NextResponse.json({ error: "invalid service or model" }, { status: 400 });
  }
  if (!(await setModel(owner, body.service, body.model))) return NextResponse.json({ error: "no key saved for that service" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const owner = req.headers.get(VERIFIED_USER_HEADER);
  if (!owner) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const service = req.nextUrl.searchParams.get("service");
  if (!isWebService(service)) return NextResponse.json({ error: "invalid service" }, { status: 400 });
  await deleteKey(owner, service);
  return NextResponse.json({ ok: true });
}
