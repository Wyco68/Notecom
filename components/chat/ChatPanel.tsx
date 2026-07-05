"use client";

import { useEffect, useRef, useState } from "react";
import type { LessonRef } from "@/lib/vault/types";
import SpinnerIcon from "../icons/SpinnerIcon";
import Markdown from "./Markdown";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatPanel({
  current,
  currentTitle,
  onClose,
}: {
  /** the document open in the reader — chat retrieval prefers it */
  current: LessonRef | null;
  currentTitle: string | null;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const question = input.trim();
    if (!question || busy) return;
    setInput("");
    setBusy(true);
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((ms) => [
      ...ms,
      { role: "user", content: question },
      { role: "assistant", content: "" },
    ]);

    const patchLast = (fn: (m: Message) => Message) =>
      setMessages((ms) => [...ms.slice(0, -1), fn(ms[ms.length - 1])]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: question,
          history,
          folder: current?.folder,
          id: current?.id,
          kind: current?.kind,
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        patchLast((m) => ({
          ...m,
          content:
            data.error === "ollama is not running — chat needs a local Ollama server"
              ? "Ollama isn't running. Install it from ollama.com, then `ollama pull llama3.2` — chat works fully offline after that."
              : `Error: ${data.error ?? "chat unavailable"}`,
        }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
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
          const data = JSON.parse(dataLine);
          if (event === "delta") {
            patchLast((m) => ({ ...m, content: m.content + data.delta }));
          } else if (event === "error") {
            patchLast((m) => ({ ...m, content: m.content + `\n\nError: ${data.error}` }));
          }
        }
      }
    } catch {
      patchLast((m) => ({ ...m, content: m.content || "Error: connection lost." }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[70vh] w-full max-w-xl flex-col rounded-lg border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-[#161b22]"
        onClick={(e) => e.stopPropagation()}
      >
      <div className="flex items-center justify-between gap-3 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <span className="shrink-0 text-sm font-semibold text-gray-900 dark:text-gray-200">
          Ask My Notes
        </span>
        {currentTitle && (
          <span
            className="truncate text-xs text-gray-500"
            title={`Answers prefer the open note: ${currentTitle}`}
          >
            about: {currentTitle}
          </span>
        )}
        <button
          onClick={onClose}
          title="Close chat"
          className="flex h-7 w-7 items-center justify-center rounded text-gray-500 hover:bg-black/5 dark:hover:bg-white/10"
        >
          ✕
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="px-1 py-2 text-sm text-gray-500">
            Ask a question about your notes. Answers come from your own
            lessons via a local model — nothing leaves this machine.
          </p>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div
              key={i}
              className="ml-6 rounded bg-blue-600/10 px-3 py-2 text-sm text-gray-900 dark:bg-blue-600/20 dark:text-gray-100"
            >
              {m.content}
            </div>
          ) : (
            <div key={i} className="mr-2 px-1">
              {m.content ? (
                <Markdown text={m.content} />
              ) : busy && i === messages.length - 1 ? (
                <SpinnerIcon className="h-4 w-4 text-gray-400" />
              ) : null}
            </div>
          )
        )}
      </div>

      <div className="border-t border-black/10 p-3 dark:border-white/10">
        <div className="flex items-end gap-2 rounded border border-black/10 bg-white px-2 py-1.5 dark:border-white/10 dark:bg-white/5">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Ask about your notes..."
            className="w-full resize-none bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-500 dark:text-gray-200"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
