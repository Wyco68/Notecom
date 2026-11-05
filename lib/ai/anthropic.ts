// Claude through the Anthropic API, with the reader's own key, called from
// the reader's browser (the key never passes through the app's server).
//
// Streamed, because a lesson is a long reply and a non-streaming request that
// size can outlive an HTTP timeout. Opus-tier models get server-side refusal
// fallbacks: a request their safety classifiers decline is re-run on
// Anthropic's recommended fallback model instead of coming back empty.

import Anthropic from "@anthropic-ai/sdk";
import { AiError, cleanMessage, type ChatRequest, type ChatResult, type Part } from "./core";

// Set explicitly, never from the environment, so a key goes only here.
const ANTHROPIC_API = "https://api.anthropic.com";

// The key is the reader's own and the page is theirs: calling from the
// browser is the point, not a leak — it keeps the key off the app's server.
const BROWSER = { dangerouslyAllowBrowser: true } as const;

/** Models that accept `fallbacks: "default"`. */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
/** Models that take `output_config.effort`. */
const EFFORT = /^claude-(?:(?:fable|opus|sonnet|haiku|mythos)-5|opus-4-[5-8]|sonnet-4-6)/;
/** Models with at least 64K output tokens. */
const LONG_OUTPUT = /^claude-(?:(?:fable|opus|sonnet|haiku|mythos)-5|opus-4-[5-8]|sonnet-4-[56]|haiku-4-5)/;

function block(p: Part): Anthropic.Beta.BetaContentBlockParam {
  if (p.kind === "pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.data } };
  }
  if (p.kind === "image") {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: p.mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
        data: p.data,
      },
    };
  }
  return { type: "text", text: p.text };
}

export async function chatAnthropic(req: ChatRequest): Promise<ChatResult> {
  const client = new Anthropic({ apiKey: req.key, baseURL: ANTHROPIC_API, maxRetries: 2, ...BROWSER });
  const effort = EFFORT.test(req.model);
  const fallback = FALLBACK_MODELS.has(req.model);

  let chars = 0;
  try {
    const stream = client.beta.messages.stream(
      {
        model: req.model,
        max_tokens: LONG_OUTPUT.test(req.model) ? 64000 : 8192,
        system: req.system,
        messages: req.turns.map((t) => ({ role: t.role, content: t.parts.map(block) })),
        ...(effort ? { output_config: { effort: "high" as const } } : {}),
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal: req.signal }
    );
    stream.on("text", (delta) => {
      chars += delta.length;
      req.onProgress?.(chars);
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      throw new AiError("refused", "The model declined to write this one.");
    }
    const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const u = message.usage;
    return {
      text,
      truncated: message.stop_reason === "max_tokens",
      usage: {
        input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        output: u.output_tokens ?? 0,
      },
    };
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.APIUserAbortError) throw new AiError("aborted", "Stopped.");
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new AiError("auth", cleanMessage(err.message, req.key));
    }
    if (err instanceof Anthropic.RateLimitError) throw new AiError("rate", cleanMessage(err.message, req.key));
    if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
      throw new AiError("bad-request", cleanMessage(err.message, req.key));
    }
    if (err instanceof Anthropic.APIConnectionError) throw new AiError("network", cleanMessage(err.message, req.key));
    if (err instanceof Anthropic.APIError) throw new AiError("other", cleanMessage(err.message, req.key));
    throw new AiError("other", cleanMessage((err as Error)?.message, req.key));
  }
}

/** The models this key can use, newest first. */
export async function listAnthropicModels(key: string, signal: AbortSignal): Promise<string[]> {
  const client = new Anthropic({ apiKey: key, baseURL: ANTHROPIC_API, maxRetries: 1, ...BROWSER });
  const ids: string[] = [];
  try {
    for await (const m of client.models.list({ limit: 100 }, { signal })) ids.push(m.id);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new AiError("auth", cleanMessage(err.message, key));
    }
    if (err instanceof Anthropic.RateLimitError) throw new AiError("rate", cleanMessage(err.message, key));
    throw new AiError("other", cleanMessage((err as Error)?.message, key));
  }
  return ids;
}
