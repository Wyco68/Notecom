"use client";

import { useEffect, useRef, useState } from "react";
import { MODEL_RE, WEB_SERVICE_IDS, WEB_SERVICES, isPlausibleKey, isWebService, type WebService } from "@/lib/ai/services";
import { forgetService, lastRunner, saveService, savedService, setLastRunner } from "@/lib/ai/keys";
import { createClient } from "@/lib/supabase/client";

export interface RunnerChoice {
  /** "claude-code" or a web service */
  runner: string;
  /** set when a web service is picked and has a key and a model */
  web: { service: WebService; label: string; key: string; model: string } | null;
  /** everything the chosen runner needs is in place */
  ready: boolean;
}

/** Who writes the document, in three kinds: the reader's Claude subscription
 *  (Claude Code on this computer), a service billed per use with their own API
 *  key, or OpenRouter with one key for many model makers. */
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
  // Keys are kept per account; null until the session is read.
  const [owner, setOwner] = useState<string | null>(null);
  const [runner, setRunner] = useState<string>(cliAvailable ? "claude-code" : "anthropic");
  const service = owner === null ? null : isWebService(runner) ? runner : null;
  const info = service ? WEB_SERVICES[service] : null;

  const [key, setKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const done = (id: string) => {
      if (cancelled) return;
      setOwner(id);
      const last = lastRunner(id);
      if (last && (last !== "claude-code" || cliAvailable)) setRunner(last);
    };
    try {
      createClient()
        .auth.getSession()
        .then(({ data }) => done(data.session?.user.id ?? "local"))
        .catch(() => done("local"));
    } catch {
      // No collaboration configured on this build: one local owner.
      done("local");
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The CLI turned out to be missing: the subscription option goes, so move off it.
  useEffect(() => {
    if (cli.installed === false && runner === "claude-code") setRunner("anthropic");
  }, [cli.installed, runner]);

  // Switching service loads what this browser remembers for it, and
  // discards any answer still on its way for the service left behind.
  useEffect(() => {
    request.current++;
    setLoading(false);
    setError(null);
    setModels([]);
    setDraft("");
    if (!service) {
      setKey(null);
      setModel("");
      return;
    }
    const saved = savedService(owner!, service);
    setKey(saved?.key ?? null);
    setModel(saved?.model ?? "");
    setRemember(!!saved?.remember);
    if (saved?.key) loadModels(service, saved.key, saved.model, !!saved.remember);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, owner]);

  useEffect(() => {
    if (service && key) {
      onChange({ runner, web: { service, label: WEB_SERVICES[service].label, key, model }, ready: MODEL_RE.test(model) });
    } else if (service) {
      onChange({ runner, web: null, ready: false });
    } else {
      onChange({ runner, web: null, ready: !!cli.installed && cli.signedIn !== false });
    }
  }, [runner, service, key, model, cli.installed, cli.signedIn, onChange]);

  // Listing the models doubles as the key check: a key is saved only once
  // its service has accepted it.
  async function loadModels(svc: WebService, k: string, keep: string | undefined, keepOnDevice: boolean) {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      // Straight to the service from this tab; loaded on first use.
      const { listModels, suggestModel } = await import("@/lib/ai/models");
      let list: string[];
      try {
        list = (await listModels(svc, k, AbortSignal.timeout(15_000))).sort();
      } catch (err: any) {
        if (id !== request.current) return;
        if (err?.kind === "auth") {
          // A saved key that stopped working is no use kept: ask for a new one.
          forgetService(owner!, svc);
          setKey(null);
          setModel("");
          setError("That key was rejected.");
        } else {
          setError(err?.kind === "rate" ? "Rate limited — try again in a minute." : "Couldn't reach the service.");
        }
        return;
      }
      if (id !== request.current) return;
      const chosen = keep && list.includes(keep) ? keep : keep || suggestModel(svc, list) || list[0] || "";
      setModels(list);
      setKey(k);
      setModel(chosen);
      saveService(owner!, svc, { key: k, model: chosen, remember: keepOnDevice });
    } catch {
      if (id === request.current) setError("Couldn't load the models.");
    } finally {
      if (id === request.current) setLoading(false);
    }
  }

  function pick(value: string) {
    setRunner(value);
    if (owner !== null) setLastRunner(owner, value);
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

      {service && info && (
        <>
          {key ? (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted">API key</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-xs text-ink-2">{`${key.slice(0, 6)}…${key.slice(-4)}`}</span>
                <button
                  onClick={() => {
                    forgetService(owner!, service);
                    setKey(null);
                    setModel("");
                    setModels([]);
                  }}
                  className="ui-btn ui-btn-xs ui-btn-text"
                >
                  Remove
                </button>
              </span>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const k = draft.trim();
                if (isPlausibleKey(k)) loadModels(service, k, undefined, remember);
                else setError("That doesn't look like an API key.");
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
                <button type="submit" disabled={!draft.trim() || loading} className="ui-btn ui-btn-sm ui-btn-secondary shrink-0">
                  {loading ? "Checking…" : "Use key"}
                </button>
              </div>
              <label className="mt-2 flex items-center gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="ui-focus h-4 w-4 accent-[rgb(var(--accent))]"
                />
                Remember on this device
              </label>
              <p className="mt-1.5 text-xs text-muted">
                Goes from this browser straight to {info.label}; Notecom&apos;s server never sees it. Cleared when you sign out.{" "}
                <a href={info.keyUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                  Get a key
                </a>
              </p>
            </form>
          )}

          {key && (
            <div>
              <label htmlFor="gen-model" className="mb-1.5 block text-sm font-medium text-ink">
                Model
              </label>
              <input
                id="gen-model"
                list="gen-models"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  saveService(owner!, service, { key, model: e.target.value, remember });
                }}
                placeholder={loading ? "Loading models…" : "Model id"}
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
