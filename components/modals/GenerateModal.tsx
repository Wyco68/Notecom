"use client";

import { useEffect, useRef, useState } from "react";
import type { Folder } from "@/lib/vault/types";
import Modal from "./Modal";
import { useToast } from "../toast/ToastProvider";

type Phase = "form" | "running" | "done" | "error" | "aborted";

export default function GenerateModal({
  folders,
  onClose,
  onGenerated,
  onSignIn,
}: {
  folders: Folder[];
  onClose: () => void;
  onGenerated: () => void;
  /** hand off to the sign-in modal when a run failed for lack of a session */
  onSignIn: () => void;
}) {
  const [folder, setFolder] = useState(folders[0]?.name ?? "");
  const [kind, setKind] = useState<"lect" | "quiz">("lect");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [log, setLog] = useState<string[]>([]);
  const [tokens, setTokens] = useState({ input: 0, output: 0 });
  const [elapsed, setElapsed] = useState(0);
  // ms timestamp of the last streamed log line — lets the UI show "still
  // working" during the long silent gaps while Claude writes a lesson, so a
  // live-but-quiet run doesn't look frozen.
  const [lastActivity, setLastActivity] = useState(0);
  const [needsAuth, setNeedsAuth] = useState(false);
  const jobRef = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const toast = useToast();

  const running = phase === "running";

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  // Terminal semantics: Ctrl+C aborts the run. Text selection wins — if the
  // user is copying from the log, let the browser copy instead of killing
  // the job.
  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
        e.preventDefault();
        if (jobRef.current) {
          fetch(`/api/generate/${jobRef.current}`, { method: "DELETE" }).catch(() => {});
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running]);

  async function start() {
    if (!file || !folder || running) return;
    setPhase("running");
    setLog([]);
    setTokens({ input: 0, output: 0 });
    setElapsed(0);
    setLastActivity(Date.now());
    setNeedsAuth(false);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("folder", folder);
      form.set("kind", kind);
      const res = await fetch("/api/generate", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed to start");
      jobRef.current = data.jobId;

      const events = await fetch(`/api/generate/${data.jobId}`);
      if (!events.ok || !events.body) throw new Error("could not follow job");
      const reader = events.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let status = "error";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const event = /^event: (.*)$/m.exec(raw)?.[1];
          const dataLine = /^data: (.*)$/m.exec(raw)?.[1];
          if (!event || !dataLine) continue;
          const payload = JSON.parse(dataLine);
          if (event === "line") {
            setLog((l) => [...l, payload.line]);
            setLastActivity(Date.now());
          }
          if (event === "tokens") setTokens(payload);
          if (event === "end") {
            status = payload.status;
            if (payload.tokens) setTokens(payload.tokens);
            setNeedsAuth(!!payload.needsAuth);
          }
        }
      }
      if (status === "done") {
        setPhase("done");
        toast.success(`Generated ${kind === "quiz" ? "quiz" : "lesson"} in "${folder.replace(/-/g, " ")}".`);
        onGenerated();
      } else if (status === "aborted") {
        setPhase("aborted");
      } else {
        setPhase("error");
        toast.error("Generation failed — see the log.");
      }
    } catch (err: any) {
      setLog((l) => [...l, `Error: ${err.message}`]);
      setPhase("error");
      toast.error(err.message);
    }
  }

  const statusLine =
    phase === "running"
      ? `● running ${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`
      : phase === "done"
      ? "✓ finished"
      : phase === "aborted"
      ? "^C aborted"
      : "✗ failed";

  // Seconds since the last log line (re-derived each second via the elapsed
  // ticker). A lesson write is one long quiet step, so surface the wait
  // rather than let the panel look hung.
  const idleSec = running && lastActivity ? Math.floor((Date.now() - lastActivity) / 1000) : 0;

  return (
    <Modal title="Generate from file" onClose={running ? () => {} : onClose}>
      {phase === "form" ? (
        <>
          <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
            Subject
          </label>
          <select
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="ui-field mb-4"
          >
            {folders.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name.replace(/-/g, " ")}
              </option>
            ))}
          </select>

          <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
            Type
          </label>
          <div className="mb-4 flex gap-2">
            {(["lect", "quiz"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`ui-btn flex-1 border ${
                  kind === k
                    ? "border-blue-600/50 bg-blue-600/10 text-blue-700 dark:bg-blue-600/20 dark:text-blue-300"
                    : "ui-btn-secondary font-normal"
                }`}
              >
                {k === "lect" ? "Lesson" : "Quiz"}
              </button>
            ))}
          </div>

          <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
            Lecture file (PDF, slides, image, markdown)
          </label>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="ui-focus mb-5 w-full rounded-md text-sm text-gray-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white file:transition-colors hover:file:bg-blue-500 dark:text-gray-400"
          />

          <button
            onClick={start}
            disabled={!file || !folder}
            className="ui-btn ui-btn-primary w-full"
          >
            Generate with Claude Code
          </button>
          <p className="mt-2.5 text-xs leading-snug text-gray-500">
            Runs your local Claude Code CLI on your existing subscription —
            same as /{kind} in a terminal. Takes a few minutes.
          </p>
        </>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between font-mono text-xs text-emerald-600 dark:text-emerald-400">
            <span>{statusLine}</span>
            <span>
              tokens in {tokens.input.toLocaleString()} · out {tokens.output.toLocaleString()}
            </span>
          </div>
          <div
            ref={logRef}
            className="mb-3 h-56 overflow-y-auto rounded-md border border-black/10 bg-[#0a0e14] p-3 font-mono text-xs leading-relaxed text-emerald-400 dark:border-white/10"
          >
            {log.map((l, i) => (
              // Cap any single line so a stray verbose block can't turn the
              // log into a wall of text (the model's closing summary is also
              // discouraged in the prompt).
              <div key={i}>{l.length > 500 ? l.slice(0, 500) + " …" : l}</div>
            ))}
            {running && (
              <div className="flex items-center gap-1 pt-1 text-emerald-400">
                <span>generating</span>
                <span className="inline-flex gap-0.5">
                  <span className="animate-pulse [animation-delay:0ms]">.</span>
                  <span className="animate-pulse [animation-delay:200ms]">.</span>
                  <span className="animate-pulse [animation-delay:400ms]">.</span>
                </span>
                {idleSec >= 5 && (
                  <span className="text-emerald-600/70">
                    (still working — {idleSec}s since last step)
                  </span>
                )}
              </div>
            )}
          </div>
          {running ? (
            <p className="text-center font-mono text-xs text-gray-500">
              writing a lesson can take a few minutes · press{" "}
              <span className="text-gray-700 dark:text-gray-300">Ctrl+C</span> to abort
            </p>
          ) : (
            <>
              {phase === "error" && (
                <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-xs leading-relaxed text-red-700 dark:text-red-300">
                  {needsAuth
                    ? "Claude Code isn't signed in — nothing was saved. Sign in, then generate again."
                    : "Generation failed — nothing was saved. See the log above for the reason; if it was a network or usage-limit error, just press Generate again."}
                </p>
              )}
              {needsAuth && (
                <button
                  onClick={onSignIn}
                  className="ui-btn ui-btn-primary mb-2 w-full"
                >
                  Sign in to Claude Code
                </button>
              )}
              <button onClick={onClose} className="ui-btn ui-btn-secondary w-full">
                Close
              </button>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
