// The AI services a reader can generate with from the web, by their own API
// key: saved encrypted on the server (lib/ai/vault.ts) and used only there,
// by job steps (lib/jobs). Each adapter's host is fixed, so the server can
// only ever send a key to its own service.

export type WebService = "anthropic" | "openai" | "gemini" | "openrouter";

/** How the reader pays: their own API key billed per use, or OpenRouter's
 *  one key for many model makers. (The third kind, a subscription, is the
 *  local Claude Code CLI — not a web service, so not in this list.) */
export type ServiceGroup = "api" | "router";

export interface ServiceInfo {
  label: string;
  group: ServiceGroup;
  /** where the reader gets a key */
  keyUrl: string;
  /** placeholder for the key field */
  keyHint: string;
}

export const WEB_SERVICES: Record<WebService, ServiceInfo> = {
  anthropic: { label: "Claude API", group: "api", keyUrl: "https://console.anthropic.com/settings/keys", keyHint: "sk-ant-…" },
  openai: { label: "OpenAI API", group: "api", keyUrl: "https://platform.openai.com/api-keys", keyHint: "sk-…" },
  gemini: { label: "Gemini API", group: "api", keyUrl: "https://aistudio.google.com/apikey", keyHint: "AIza…" },
  openrouter: { label: "OpenRouter", group: "router", keyUrl: "https://openrouter.ai/keys", keyHint: "sk-or-…" },
};

export const WEB_SERVICE_IDS = Object.keys(WEB_SERVICES) as WebService[];

export function isWebService(s: unknown): s is WebService {
  return typeof s === "string" && Object.prototype.hasOwnProperty.call(WEB_SERVICES, s);
}

/** A model id as every one of these services spells them. */
export const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;

/** A key is opaque, but never long or multi-line. */
export function isPlausibleKey(key: unknown): key is string {
  return typeof key === "string" && key.length >= 8 && key.length <= 512 && /^[\x21-\x7e]+$/.test(key);
}
