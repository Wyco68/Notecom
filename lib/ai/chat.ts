// Sends a conversation to whichever web service the reader picked.

import { chatAnthropic } from "./anthropic";
import { chatOpenAICompatible } from "./openai";
import { chatGemini } from "./gemini";
import type { ChatRequest, ChatResult } from "./core";

export * from "./core";

export function chat(req: ChatRequest): Promise<ChatResult> {
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
