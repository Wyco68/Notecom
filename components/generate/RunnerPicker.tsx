"use client";

import { useEffect, useRef, useState } from "react";
import { MODEL_RE, WEB_SERVICE_IDS, WEB_SERVICES, isPlausibleKey, isWebService, type WebService } from "@/lib/ai/services";
import { preferredRunner, savedServices, setPreferredRunner, clearLegacyKeys, type SavedService } from "@/lib/ai/client";

export interface RunnerChoice {
  /** "claude-code" or a web service */
  runner: string;
  /** set when a web service is picked and has a saved key and a model */
  web: { service: WebService; label: string; model: string } | null;
  /** everything the chosen runner needs is in place */
  ready: boolean;
}

// The model lists this page has loaded, per service: listing calls the
// service with the saved key, so it is done once, not on every open.
const modelCache = new Map<WebService, string[]>();

/** Who writes the document, in three kinds: the reader's Claude subscription
 *  (Claude Code on this computer), a service billed per use with their own API
 *  key, or OpenRouter with one key for many model makers. A key is sent to the
 *  server once, stored there encrypted, and never comes back to the browser. */
export default function RunnerPicker({
  cli,
  onSignIn,
  onChange,
}: {
  /** what the local Claude Code CLI can do; undefined while still checking */
  cli: { installed?: boolean; signedIn?: boolean };
  onSignIn: () => void;
  onChange: (choice: RunnerChoice) => void;
}) {
  const cliAvailable = cli.installed !== false;
  const [runner, setRunner] = useState<string>(() => preferredRunner() ?? (cliAvailable ? "claude-code" : "anthropic"));
  const service = isWebService(runner) ? runner : null;
  const info = service ? WEB_SERVICES[service] : null;

  const [vault, setVault] = useState<{ ready: boolean; keys: SavedService[] } | null>(null);
  const saved = service ? vault?.keys.find((k) => k.service === service) ?? null : null;
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    clearLegacyKeys();
    savedServices().then(setVault);
  }, []);

  useEffect(() => {
    if (cli.installed === false && runner === "claude-code") setRunner("anthropic");
  }, [cli.installed, runner]);

  // Switching service: its saved model, and its model list (once per page).
  useEffect(() => {
    const id = ++request.current;
    setError(null);
    setDraft("");
    setBusy(false);
    setModel(saved?.model ?? "");
    setModels(service ? modelCache.get(service) ?? [] : []);
    if (!service || !saved || modelCache.has(service)) return;
    fetch(`/api/ai/models?service=${service}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (id !== request.current) return;
        if (!r.ok) {
          setError(r.status === 401 ? "The saved key was rejected — remove it and add a new one." : d.error || "Couldn't load the models.");
          return;
        }
        modelCache.set(service, d.models ?? []);
        setModels(d.models ?? []);
      })
      .catch(() => id === request.current && setError("Couldn't load the models."));
  }, [service, saved]);

  useEffect(() => {
    if (service) {
      onChange({
        runner,
        web: saved && MODEL_RE.test(model) ? { service, label: WEB_SERVICES[service].label, model } : null,
        ready: !!saved && MODEL_RE.test(model) && model === (saved.model ?? ""),
      });
    } else {
      onChange({ runner, web: null, ready: !!cli.installed && cli.signedIn !== false });
    }
  }, [runner, service, saved, model, cli.installed, cli.signedIn, onChange]);

  function pick(value: string) {
    setRunner(value);
    setPreferredRunner(value);
  }

  async function saveKey() {
    const key = draft.trim();
    if (!service) return;
    if (!isPlausibleKey(key)) {
      setError("That doesn't look like an API key.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, key }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 401 ? "That key was rejected." : d.error || "Couldn't save the key.");
        return;
      }
      setDraft("");
      modelCache.set(service, d.models ?? []);
      setVault(await savedServices(true));
    } finally {
      setBusy(false);
    }
  }

  async function chooseModel(value: string) {
    if (!service || !MODEL_RE.test(value) || value === saved?.model) return;
    const res = await fetch("/api/ai/keys", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service, model: value }),
    }).catch(() => null);
    if (res?.ok) setVault(await savedServices(true));
    else setError("Couldn't save the model.");
  }

  async function removeKey() {
    if (!service) return;
    await fetch(`/api/ai/keys?service=${service}`, { method: "DELETE" }).catch(() => {});
    modelCache.delete(service);
    setVault(await savedServices(true));
  }

  return (
    <div className="space-y-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <label htmlFor="gen-runner" className="text-sm text-muted">
          Runs with
        </label>
        <select
          id="gen-runner"
          value={runner}
          onChange={(e) => pick(e.target.value)}
          className="ui-field w-auto min-w-[15rem] py-1.5 font-medium"
        >
          {cliAvailable && (
            <optgroup label="Subscription">
              <option value="claude-code">Claude Code · this computer</option>
            </optgroup>
          )}
          <optgroup label="Pay per use · your API key">
            {WEB_SERVICE_IDS.filter((id) => WEB_SERVICES[id].group === "api").map((id) => (
              <option key={id} value={id}>
                {WEB_SERVICES[id].label}
              </option>
            ))}
          </optgroup>
          <optgroup label="OpenRouter · any model">
            {WEB_SERVICE_IDS.filter((id) => WEB_SERVICES[id].group === "router").map((id) => (
              <option key={id} value={id}>
                {WEB_SERVICES[id].label}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      {runner === "claude-code" && cli.signedIn === false && (
        <p className="flex items-center justify-between gap-3 text-sm text-warn">
          Claude Code is signed out.
          <button onClick={onSignIn} className="ui-btn ui-btn-sm ui-btn-text">
            Sign in
          </button>
        </p>
      )}

      {service && info && vault && !vault.ready && (
        <p className="text-sm text-warn">Web services aren&apos;t set up on this server yet.</p>
      )}

      {service && info && vault?.ready && (
        <>
          {saved ? (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted">API key</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-xs text-ink-2">••••{saved.hint}</span>
                <button onClick={removeKey} className="ui-btn ui-btn-xs ui-btn-text">
                  Remove
                </button>
              </span>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveKey();
              }}
            >
              <label htmlFor="gen-key" className="mb-1.5 block text-sm font-medium text-ink">
                {info.label} key
              </label>
              <div className="flex gap-2">
                <input
                  id="gen-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={info.keyHint}
                  className="ui-field min-w-0 flex-1 font-mono"
                />
                <button type="submit" disabled={!draft.trim() || busy} className="ui-btn ui-btn-sm ui-btn-secondary shrink-0">
                  {busy ? "Checking…" : "Save key"}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Sent once, then stored encrypted for your account only; it never comes back to the browser.{" "}
                <a href={info.keyUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                  Get a key
                </a>
              </p>
            </form>
          )}

          {saved && (
            <div>
              <label htmlFor="gen-model" className="mb-1.5 block text-sm font-medium text-ink">
                Model
              </label>
              <input
                id="gen-model"
                list="gen-models"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onBlur={(e) => chooseModel(e.target.value.trim())}
                placeholder="Model id"
                spellCheck={false}
                className="ui-field font-mono"
              />
              <datalist id="gen-models">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          )}

          {error && <p className="text-xs text-danger">{error}</p>}
        </>
      )}
    </div>
  );
}
