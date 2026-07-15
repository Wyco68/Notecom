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
      ? "● waiting for browser sign-in"
      : phase === "done"
      ? "✓ signed in"
      : phase === "aborted"
      ? "cancelled"
      : "✗ failed";

  return (
    <Modal title="Sign in to Claude Code" onClose={running ? () => {} : onClose}>
      {phase === "idle" ? (
        <>
          <p className="mb-3 text-sm leading-snug text-gray-600 dark:text-gray-400">
            Generating notes runs the Claude Code CLI on your own account. Your
            session has expired or was never set up — signing in here runs the
            same flow as a terminal would.
          </p>
          <button
            onClick={() => start("claudeai")}
            className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Sign in with Claude subscription
          </button>
          <button
            onClick={() => start("console")}
            className="mt-2 w-full rounded border border-black/10 px-3 py-2 text-sm text-gray-600 hover:bg-black/5 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
          >
            Use Anthropic Console instead
          </button>
          <p className="mt-2 text-xs leading-snug text-gray-500">
            Opens Anthropic in your browser. The app never sees or stores your
            credentials — Claude Code keeps them, exactly as it does from a
            terminal.
          </p>
        </>
      ) : (
        <>
          <div className="mb-2 font-mono text-xs text-emerald-600 dark:text-emerald-400">
            {statusLine}
          </div>

          {url && running && (
            <p className="mb-2 break-all text-xs leading-snug text-gray-600 dark:text-gray-400">
              Didn&apos;t open?{" "}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline dark:text-blue-400"
              >
                {url}
              </a>
            </p>
          )}

          <div
            ref={logRef}
            className="mb-3 h-40 overflow-y-auto rounded border border-black/20 bg-[#0a0e14] p-2.5 font-mono text-xs leading-relaxed text-emerald-400 dark:border-white/10"
          >
            {log.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap">
                {l}
              </div>
            ))}
          </div>

          {awaitingCode && running && (
            <div className="mb-3">
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                Paste the authorization code from the browser
              </label>
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendCode()}
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 rounded border border-black/10 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
                />
                <button
                  onClick={sendCode}
                  disabled={!code.trim()}
                  className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  Submit
                </button>
              </div>
            </div>
          )}

          {running ? (
            <button
              onClick={cancel}
              className="w-full rounded border border-black/10 px-3 py-2 text-sm text-gray-600 hover:bg-black/5 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
            >
              Cancel
            </button>
          ) : (
            <div className="flex gap-2">
              {phase !== "done" && (
                <button
                  onClick={() => start("claudeai")}
                  className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
                >
                  Try again
                </button>
              )}
              <button
                onClick={onClose}
                className="flex-1 rounded border border-black/10 px-3 py-2 text-sm text-gray-600 hover:bg-black/5 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
              >
                Close
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
