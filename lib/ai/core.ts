// One conversation shape for every web service. A run builds turns from these
// parts; each adapter translates them into its own API's message format.

import type { WebService } from "./services";

/** File parts carry base64, encoded once when the upload is read rather than
 *  again on every request of a run. */
export type Part =
  | { kind: "text"; text: string }
  | { kind: "pdf"; data: string; name: string }
  | { kind: "image"; data: string; mime: string };

export interface Turn {
  role: "user" | "assistant";
  parts: Part[];
}

export interface ChatRequest {
  service: WebService;
  key: string;
  model: string;
  system: string;
  turns: Turn[];
  signal: AbortSignal;
  /** called as text streams in, with the reply's length so far */
  onProgress?: (chars: number) => void;
}

export interface ChatResult {
  text: string;
  /** the reply stopped at the model's output limit */
  truncated: boolean;
  usage: { input: number; output: number };
}

export type AiErrorKind = "auth" | "rate" | "bad-request" | "refused" | "network" | "aborted" | "other";

export class AiError extends Error {
  constructor(
    public kind: AiErrorKind,
    message: string
  ) {
    super(message);
  }
}

/** A provider's error text, with the caller's key scrubbed and the length capped. */
export function cleanMessage(message: unknown, key: string): string {
  const text = typeof message === "string" ? message : "";
  return (key ? text.split(key).join("[key]") : text).replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Maps an HTTP status to the kind of failure the reader can act on. */
export function kindForStatus(status: number): AiErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate";
  if (status >= 400 && status < 500) return "bad-request";
  return "other";
}

/**
 * Reads a `text/event-stream` body and hands each `data:` payload to `onData`.
 * Shared by the adapters that call their API with fetch.
 */
export async function readSse(body: ReadableStream<Uint8Array>, onData: (data: string) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line.startsWith("data:")) onData(line.slice(5).trimStart());
    }
  }
  const rest = buf.trim();
  if (rest.startsWith("data:")) onData(rest.slice(5).trimStart());
}
