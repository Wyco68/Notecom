// Google Gemini through its REST API, streamed as server-sent events.

import { AiError, cleanMessage, kindForStatus, readSse, type ChatRequest, type ChatResult, type Part } from "./core";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

function part(p: Part) {
  if (p.kind === "pdf") return { inline_data: { mime_type: "application/pdf", data: p.data } };
  if (p.kind === "image") return { inline_data: { mime_type: p.mime, data: p.data } };
  return { text: p.text };
}

async function failure(res: Response, key: string): Promise<AiError> {
  const body = await res.json().catch(() => null);
  const message = cleanMessage(body?.error?.message ?? res.statusText, key);
  // Gemini answers a bad key with 400 INVALID_ARGUMENT, not 401.
  const badKey = body?.error?.details?.some?.((d: any) => d?.reason === "API_KEY_INVALID");
  return new AiError(badKey ? "auth" : kindForStatus(res.status), message || `HTTP ${res.status}`);
}

export async function chatGemini(req: ChatRequest): Promise<ChatResult> {
  const model = req.model.replace(/^models\//, "");
  let res: Response;
  try {
    res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "x-goog-api-key": req.key, "Content-Type": "application/json" },
      signal: req.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: req.turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: t.parts.map(part) })),
      }),
    });
  } catch (err) {
    if (req.signal.aborted) throw new AiError("aborted", "Stopped.");
    throw new AiError("network", cleanMessage((err as Error)?.message, req.key));
  }
  if (!res.ok || !res.body) throw await failure(res, req.key);

  let text = "";
  let finish: string | null = null;
  let blocked = false;
  const usage = { input: 0, output: 0 };
  try {
    await readSse(res.body, (data) => {
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        return;
      }
      if (chunk.promptFeedback?.blockReason) blocked = true;
      const cand = chunk.candidates?.[0];
      for (const p of cand?.content?.parts ?? []) {
        // A thinking model's reasoning parts are not the reply.
        if (typeof p.text === "string" && !p.thought) {
          text += p.text;
          req.onProgress?.(text.length);
        }
      }
      if (cand?.finishReason) finish = cand.finishReason;
      if (chunk.usageMetadata) {
        usage.input = chunk.usageMetadata.promptTokenCount ?? usage.input;
        usage.output = (chunk.usageMetadata.candidatesTokenCount ?? 0) + (chunk.usageMetadata.thoughtsTokenCount ?? 0);
      }
    });
  } catch (err) {
    if (req.signal.aborted) throw new AiError("aborted", "Stopped.");
    throw new AiError("network", cleanMessage((err as Error)?.message, req.key));
  }
  if (blocked || finish === "SAFETY" || finish === "PROHIBITED_CONTENT" || finish === "RECITATION") {
    throw new AiError("refused", "The model declined to write this one.");
  }
  return { text, truncated: finish === "MAX_TOKENS", usage };
}

const NOT_TEXT = /embedding|aqa|imagen|veo|tts|image|live|native-audio/i;

/** The models this key can use for text generation. */
export async function listGeminiModels(key: string, signal: AbortSignal): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/models?pageSize=1000`, { headers: { "x-goog-api-key": key }, signal });
  } catch (err) {
    throw new AiError("network", cleanMessage((err as Error)?.message, key));
  }
  if (!res.ok) throw await failure(res, key);
  const body = await res.json().catch(() => ({}));
  const models: Array<{ name?: string; supportedGenerationMethods?: string[] }> = body?.models ?? [];
  return models
    .filter((m) => m.name && (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => m.name!.replace(/^models\//, ""))
    .filter((id) => !NOT_TEXT.test(id));
}
