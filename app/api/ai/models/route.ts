import { NextRequest, NextResponse } from "next/server";
import { VERIFIED_USER_HEADER } from "@/middleware";
import { AiError } from "@/lib/ai/core";
import { listModels, suggestModel } from "@/lib/ai/models";
import { isPlausibleKey, isWebService } from "@/lib/ai/services";

// The models a key can use, and the one to preselect. A POST so the key
// travels in the body, never in a URL that a log or a proxy might keep.
export async function POST(req: NextRequest) {
  const userId = req.headers.get(VERIFIED_USER_HEADER);
  if (!userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const service = body?.service;
  const key = body?.key;
  if (!isWebService(service) || !isPlausibleKey(key)) {
    return NextResponse.json({ error: "invalid service or key" }, { status: 400 });
  }

  try {
    const models = (await listModels(service, key, AbortSignal.timeout(15_000))).sort();
    return NextResponse.json({ models, suggested: suggestModel(service, models) });
  } catch (err) {
    if (err instanceof AiError && err.kind === "auth") {
      return NextResponse.json({ error: "key rejected" }, { status: 401 });
    }
    if (err instanceof AiError && err.kind === "rate") {
      return NextResponse.json({ error: "rate limited — try again in a minute" }, { status: 429 });
    }
    return NextResponse.json({ error: "couldn't reach the service" }, { status: 502 });
  }
}
