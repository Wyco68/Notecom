// Sends a conversation to whichever web service the reader picked.

import { chatAnthropic } from "./anthropic";
import { chatOpenAICompatible } from "./openai";
import { chatGemini } from "./gemini";
import { AiError, type ChatRequest, type ChatResult } from "./core";
import { MODEL_RE } from "./services";

export * from "./core";

export async function chat(req: ChatRequest): Promise<ChatResult> {
  // Checked here, next to the call: the model id goes into a request path,
  // and a job row's copy of it is the reader's to change.
  if (!MODEL_RE.test(req.model) || req.model.includes("..")) throw new AiError("bad-request", "that model id isn't valid");
  switch (req.service) {
    case "anthropic":
      return chatAnthropic(req);
    case "gemini":
      return chatGemini(req);
    case "openai":
    case "openrouter":
      return chatOpenAICompatible(req);
  }
}
