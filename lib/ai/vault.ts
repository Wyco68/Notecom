// Readers' AI keys, encrypted at rest. Server only.
//
// A key reaches the server once, when the reader saves it, and is encrypted
// before it is written: AES-256-GCM under a key derived from AI_KEYS_SECRET,
// a secret only the server holds (never in the database, never in the
// browser). The owner and service are the additional data, so a ciphertext
// moved to another row or another reader fails to decrypt. It is decrypted
// only inside a job step, for the one call that needs it, and never returned
// by any route — the browser only ever sees the last four characters.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { isWebService, type WebService } from "./services";

const VERSION = "v1";

function secretKey(): Buffer {
  const raw = process.env.AI_KEYS_SECRET;
  const secret = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (secret.length < 32) throw new VaultError("web generation isn't set up on this server (AI_KEYS_SECRET is missing)");
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), "notecom ai keys v1", 32));
}

export class VaultError extends Error {}

/** True when this server can store keys at all. */
export function vaultReady(): boolean {
  try {
    secretKey();
    return true;
  } catch {
    return false;
  }
}

function aad(owner: string, service: WebService) {
  return Buffer.from(`${owner}|${service}`);
}

export function encryptKey(owner: string, service: WebService, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv, { authTagLength: 16 });
  cipher.setAAD(aad(owner, service));
  const body = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), body.toString("base64"), cipher.getAuthTag().toString("base64")].join(":");
}

export function decryptKey(owner: string, service: WebService, stored: string): string {
  const [version, iv, body, tag] = stored.split(":");
  if (version !== VERSION || !iv || !body || !tag) throw new VaultError("the saved key can't be read — save it again");
  try {
    const authTag = Buffer.from(tag, "base64");
    // A full 16-byte tag only: GCM would otherwise accept a truncated one.
    if (authTag.length !== 16) throw new Error("short tag");
    const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64"), { authTagLength: 16 });
    decipher.setAAD(aad(owner, service));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new VaultError("the saved key can't be read — save it again");
  }
}

export interface SavedKeyInfo {
  service: WebService;
  hint: string;
  model: string | null;
  updatedAt: string;
}

/** The caller's saved keys, without the keys. */
export async function listKeys(): Promise<SavedKeyInfo[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("notes_ai_keys").select("service,hint,model,updated_at");
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((r) => isWebService(r.service))
    .map((r) => ({ service: r.service as WebService, hint: r.hint, model: r.model, updatedAt: r.updated_at }));
}

export async function saveKey(owner: string, service: WebService, key: string, model: string | null): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("notes_ai_keys").upsert({
    owner_id: owner,
    service,
    ciphertext: encryptKey(owner, service, key),
    hint: key.slice(-4),
    model,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function setModel(owner: string, service: WebService, model: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes_ai_keys")
    .update({ model, updated_at: new Date().toISOString() })
    .eq("owner_id", owner)
    .eq("service", service)
    .select("service");
  if (error) throw new Error(error.message);
  return !!data?.length;
}

export async function deleteKey(owner: string, service: WebService): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("notes_ai_keys").delete().eq("owner_id", owner).eq("service", service);
  if (error) throw new Error(error.message);
}

/** The caller's key for one service, decrypted — for a job step only. */
export async function useKey(owner: string, service: WebService): Promise<{ key: string; model: string | null } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes_ai_keys")
    .select("ciphertext,model")
    .eq("owner_id", owner)
    .eq("service", service)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { key: decryptKey(owner, service, data.ciphertext), model: data.model };
}
