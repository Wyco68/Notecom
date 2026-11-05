// The reader's web-service keys and model choices, in this browser only —
// never sent to the app's database. A key goes to the server with a generate
// request, is used for that run, and is dropped when the run ends.
//
// Scoped to the signed-in account, so a shared or lab computer never hands one
// person's key to the next; kept for this page only unless the reader asks to
// remember it; and wiped from the device on sign-out (clearAllKeys).

import { isWebService, type WebService } from "./services";

const PREFIX = "notecom.ai:";

export interface SavedService {
  key: string;
  model?: string;
  /** kept on this device across reloads, not just for this page */
  remember?: boolean;
}

interface Store {
  /** what the Generate dialog last ran with: "claude-code" or a web service */
  last?: string;
  services: Partial<Record<WebService, SavedService>>;
}

// Keys the reader chose not to remember: gone with the page.
const memory = new Map<string, Store>();

function read(owner: string): Store {
  const kept = memory.get(owner);
  let stored: Store = { services: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFIX + owner) ?? "null");
    if (raw && typeof raw === "object" && raw.services && typeof raw.services === "object") stored = raw as Store;
  } catch {
    // Private mode or a mangled value: start empty.
  }
  return { last: kept?.last ?? stored.last, services: { ...stored.services, ...kept?.services } };
}

function write(owner: string, store: Store) {
  const remembered: Store = { last: store.last, services: {} };
  const transient: Store = { services: {} };
  for (const id of Object.keys(store.services) as WebService[]) {
    const s = store.services[id]!;
    if (s.remember) remembered.services[id] = s;
    else transient.services[id] = s;
  }
  memory.set(owner, transient);
  try {
    localStorage.setItem(PREFIX + owner, JSON.stringify(remembered));
  } catch {
    // Not kept this time; the run itself is unaffected.
  }
}

export function savedService(owner: string, service: WebService): SavedService | undefined {
  return read(owner).services[service];
}

export function saveService(owner: string, service: WebService, value: SavedService) {
  const store = read(owner);
  store.services[service] = value;
  write(owner, store);
}

export function forgetService(owner: string, service: WebService) {
  const store = read(owner);
  delete store.services[service];
  if (store.last === service) delete store.last;
  write(owner, store);
}

export function lastRunner(owner: string): string | undefined {
  const last = read(owner).last;
  return last === "claude-code" || isWebService(last) ? last : undefined;
}

export function setLastRunner(owner: string, runner: string) {
  const store = read(owner);
  store.last = runner;
  write(owner, store);
}

/** Removes every account's keys from this device. Called on sign-out. */
export function clearAllKeys() {
  memory.clear();
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX) || k === "notecom.ai") localStorage.removeItem(k);
    }
  } catch {
    // Storage unavailable: nothing was kept there either.
  }
}
