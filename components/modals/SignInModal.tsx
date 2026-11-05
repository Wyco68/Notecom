"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import { useToast } from "../toast/ToastProvider";

// Sign-in for the local Claude Code CLI, so an expired session can be fixed
// from the app instead of a terminal the packaged build doesn't have.
//
// The browser never handles the credential: this drives `claude auth login`
// server-side and shows its output. The one value the user may type is the
// short-lived authorization code, and only when the CLI asks for it — it is
// piped to that process's stdin and never stored. There is no API-key field
// by design (see lib/auth/cli.ts).

type Phase = "idle" | "running" | "done" | "error" | "aborted";

export default function SignInModal({
  onClose,
  onSignedIn,
}: {
  onClose: () => void;
  onSignedIn: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [url, setUrl] = useState<string | undefined>();
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [code, setCode] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);
  const toast = useToast();

  const running = phase === "running";

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  // The browser can't be opened for the user from a server route, so the URL
  // is opened here the moment the CLI prints it — with the link left visible
  // as the fallback when a popup blocker eats it.
  useEffect(() => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }, [url]);

  async function start(mode: "claudeai" | "console") {
    if (running) return;
    setPhase("running");
    setLog([]);
    setUrl(undefined);
    setAwaitingCode(false);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", mode }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "could not start sign-in");

      const stream = await fetch("/api/auth/stream");
      if (!stream.ok || !stream.body) throw new Error("could not follow sign-in");

      const reader = stream.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let final: Phase = "error";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";
        for (const raw of chunks) {
          const event = /^event: (.*)$/m.exec(raw)?.[1];
          const dataLine = /^data: (.*)$/m.exec(raw)?.[1];
          if (!event || !dataLine) continue;
          const payload = JSON.parse(dataLine);
          if (event === "line") setLog((l) => [...l, payload.line]);
          if (event === "meta") {
            if (payload.url) setUrl(payload.url);
            setAwaitingCode(!!payload.awaitingCode);
          }
          if (event === "end") final = payload.status;
        }
      }

      setPhase(final);
      if (final === "done") {
        toast.success("Signed in to Claude Code.");
        onSignedIn();
      } else if (final === "error") {
        toast.error("Sign-in failed — see the log.");
      }
    } catch (err: any) {
      setLog((l) => [...l, `Error: ${err.message}`]);
      setPhase("error");
      toast.error(err.message);
    }
  }

  async function sendCode() {
    if (!code.trim()) return;
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "code", code }),
    }).catch(() => {});
    setCode("");
    setAwaitingCode(false);
  }

  async function cancel() {
    await fetch("/api/auth", { method: "DELETE" }).catch(() => {});
  }

  const statusLine =
    phase === "running"
      ? "Waiting for browser sign-in…"
      : phase === "done"
      ? "Signed in"
      : phase === "aborted"
      ? "Cancelled"
      : "Sign-in failed";

  return (
    <Modal title="Sign in to Claude Code" onClose={running ? () => {} : onClose}>
      {phase === "idle" ? (
        <>
          <p className="mb-5 text-sm text-ink-2">Generating needs a Claude Code session.</p>
          <button
            onClick={() => start("claudeai")}
            className="ui-btn ui-btn-primary w-full"
          >
            Sign in with Claude subscription
          </button>
          <button
            onClick={() => start("console")}
            className="ui-btn ui-btn-secondary mt-2 w-full"
          >
            Use Anthropic Console instead
          </button>
          <p className="mt-3 text-center text-xs text-muted">Opens in your browser. Notecom never sees your credentials.</p>
        </>
      ) : (
        <>
          <div className="mb-2 text-sm font-semibold text-ink">
            {statusLine}
          </div>

          {url && running && (
            <p className="mb-2 break-all text-xs leading-snug text-muted">
              Didn&apos;t open?{" "}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                {url}
              </a>
            </p>
          )}

          <div
            ref={logRef}
            className="mb-3 h-40 overflow-y-auto rounded-lg bg-cover/70 p-3 font-mono text-xs leading-relaxed text-ink-2"
          >
            {log.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap">
                {l}
              </div>
            ))}
          </div>

          {awaitingCode && running && (
            <div className="mb-3">
              <label className="mb-1.5 block text-sm font-medium text-ink">
                Paste the authorization code from the browser
              </label>
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendCode()}
                  autoComplete="off"
                  spellCheck={false}
                  className="ui-field min-w-0 flex-1 font-mono"
                />
                <button
                  onClick={sendCode}
                  disabled={!code.trim()}
                  className="ui-btn ui-btn-primary shrink-0"
                >
                  Submit
                </button>
              </div>
            </div>
          )}

          {running ? (
            <button onClick={cancel} className="ui-btn ui-btn-secondary w-full">
              Cancel
            </button>
          ) : (
            <div className="flex gap-2">
              {phase !== "done" && (
                <button
                  onClick={() => start("claudeai")}
                  className="ui-btn ui-btn-primary flex-1"
                >
                  Try again
                </button>
              )}
              <button onClick={onClose} className="ui-btn ui-btn-secondary flex-1">
                Close
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
