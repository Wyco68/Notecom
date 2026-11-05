// Lists the models a key can use, from the browser, so the reader picks from
// what their account really has instead of a list that goes stale here.
// Listing doubles as the key check: a rejected key fails here, before any
// upload.

import { listAnthropicModels } from "./anthropic";
import { listOpenAICompatibleModels } from "./openai";
import { listGeminiModels } from "./gemini";
import type { WebService } from "./services";

export async function listModels(service: WebService, key: string, signal: AbortSignal): Promise<string[]> {
  switch (service) {
    case "anthropic":
      return listAnthropicModels(key, signal);
    case "gemini":
      return listGeminiModels(key, signal);
    case "openai":
    case "openrouter":
      return listOpenAICompatibleModels(service, key, signal);
  }
}

// Newest version first: "gpt-6.1" before "gpt-6", "gemini-3-pro" before "gemini-2.5-pro".
function versionOf(id: string): number {
  const m = id.match(/(\d+(?:[.-]\d+)?)/);
  return m ? parseFloat(m[1].replace("-", ".")) : 0;
}

const SMALL = /mini|nano|lite|flash-8b|haiku|small|tiny/i;

/**
 * The model to preselect: the strongest general one on the list. A guess the
 * reader can change, never a requirement.
 */
export function suggestModel(service: WebService, models: string[]): string {
  if (!models.length) return "";
  const pick = (preferred: string[], pattern: RegExp) => {
    for (const p of preferred) if (models.includes(p)) return p;
    const candidates = models.filter((m) => pattern.test(m) && !SMALL.test(m) && !/preview|exp/i.test(m));
    const pool = candidates.length ? candidates : models.filter((m) => pattern.test(m));
    return pool.sort((a, b) => versionOf(b) - versionOf(a))[0] ?? models[0];
  };
  switch (service) {
    case "anthropic":
      return pick(["claude-opus-5-5"], /^claude-opus/);
    case "openai":
      return pick([], /^gpt-\d/);
    case "gemini":
      return pick([], /^gemini-[\d.]+-pro/);
    case "openrouter":
      return pick(["anthropic/claude-opus-5-5"], /^anthropic\/claude-opus/);
  }
}
