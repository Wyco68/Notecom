// OpenAI and OpenRouter: the same Chat Completions API at two fixed hosts.
// OpenRouter reaches most other model makers through that one shape, which is
// what makes "any model" possible without an endpoint the reader types in.

import { AiError, cleanMessage, kindForStatus, readSse, type ChatRequest, type ChatResult, type Part } from "./core";

const BASE: Record<"openai" | "openrouter", string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

function headers(service: "openai" | "openrouter", key: string): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  // OpenRouter's app attribution; harmless elsewhere, so only sent there.
  if (service === "openrouter") h["X-Title"] = "Notecom";
  return h;
}

function contentPart(p: Part) {
  if (p.kind === "pdf") {
    return { type: "file", file: { filename: p.name, file_data: `data:application/pdf;base64,${p.data}` } };
  }
  if (p.kind === "image") {
    return { type: "image_url", image_url: { url: `data:${p.mime};base64,${p.data}` } };
  }
  return { type: "text", text: p.text };
}

async function failure(res: Response, key: string): Promise<AiError> {
  const body = await res.json().catch(() => null);
  const message = cleanMessage(body?.error?.message ?? res.statusText, key);
  return new AiError(kindForStatus(res.status), message || `HTTP ${res.status}`);
}

export async function chatOpenAICompatible(req: ChatRequest): Promise<ChatResult> {
  const service = req.service as "openai" | "openrouter";
  let res: Response;
  try {
    res = await fetch(`${BASE[service]}/chat/completions`, {
      method: "POST",
      headers: headers(service, req.key),
      signal: req.signal,
      body: JSON.stringify({
        model: req.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: req.system },
          ...req.turns.map((t) =>
            t.role === "assistant"
              ? { role: "assistant", content: t.parts.map((p) => (p.kind === "text" ? p.text : "")).join("") }
              : { role: "user", content: t.parts.map(contentPart) }
          ),
        ],
      }),
    });
  } catch (err) {
    if (req.signal.aborted) throw new AiError("aborted", "Stopped.");
    throw new AiError("network", cleanMessage((err as Error)?.message, req.key));
  }
  if (!res.ok || !res.body) throw await failure(res, req.key);

  let text = "";
  let finish: string | null = null;
  const usage = { input: 0, output: 0 };
  let streamError: string | null = null;
  try {
    await readSse(res.body, (data) => {
      if (data === "[DONE]") return;
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        return;
      }
      // OpenRouter reports an upstream failure inside the stream.
      if (chunk.error) streamError = cleanMessage(chunk.error.message, req.key) || "the service reported an error";
      const choice = chunk.choices?.[0];
      const delta = choice?.delta?.content;
      if (typeof delta === "string" && delta) {
        text += delta;
        req.onProgress?.(text.length);
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (chunk.usage) {
        usage.input = chunk.usage.prompt_tokens ?? usage.input;
        usage.output = chunk.usage.completion_tokens ?? usage.output;
      }
    });
  } catch (err) {
    if (req.signal.aborted) throw new AiError("aborted", "Stopped.");
    throw new AiError("network", cleanMessage((err as Error)?.message, req.key));
  }
  if (streamError) throw new AiError("other", streamError);
  if (finish === "content_filter") throw new AiError("refused", "The model declined to write this one.");
  return { text, truncated: finish === "length", usage };
}

// Embeddings, audio, image and moderation models can't write a lesson.
const NOT_CHAT = /embed|whisper|tts|dall-e|audio|realtime|transcribe|moderation|image|search|davinci|babbage|sora/i;

/** The models this key can use. */
export async function listOpenAICompatibleModels(
  service: "openai" | "openrouter",
  key: string,
  signal: AbortSignal
): Promise<string[]> {
  let res: Response;
  let check: Response | null = null;
  try {
    // OpenRouter lists its catalogue to anyone, so its key is checked on its
    // own endpoint, at the same time.
    [res, check] = await Promise.all([
      fetch(`${BASE[service]}/models`, { headers: headers(service, key), signal }),
      service === "openrouter" ? fetch(`${BASE.openrouter}/key`, { headers: headers(service, key), signal }) : null,
    ]);
  } catch (err) {
    throw new AiError("network", cleanMessage((err as Error)?.message, key));
  }
  if (service === "openrouter" && (!check || !check.ok)) throw new AiError("auth", "OpenRouter didn't accept that key.");
  if (!res.ok) throw await failure(res, key);
  const body = await res.json().catch(() => ({}));
  const items: Array<{ id?: string; architecture?: { output_modalities?: string[] } }> = body?.data ?? [];
  return items
    .filter((m) => typeof m.id === "string")
    .filter((m) => service === "openrouter" ? (m.architecture?.output_modalities ?? ["text"]).includes("text") : !NOT_CHAT.test(m.id!))
    .map((m) => m.id!);
}
