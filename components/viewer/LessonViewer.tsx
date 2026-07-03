"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { LessonRef } from "@/lib/vault/types";
import HtmlRenderer from "./HtmlRenderer";

export default function LessonViewer({ lesson }: { lesson: LessonRef | null }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!lesson) {
      setHtml(null);
      return;
    }
    // Guard against a fast lesson switch: an earlier fetch resolving after a
    // later one would otherwise leave the wrong lesson on screen.
    let cancelled = false;
    setHtml(null);
    const base = lesson.kind === "quiz" ? "/api/quiz" : "/api/lesson";
    fetch(
      `${base}/${encodeURIComponent(lesson.folder)}/${encodeURIComponent(lesson.id)}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled)
          setHtml(data.html ?? `<p>Error: ${data.error ?? "not found"}</p>`);
      })
      .catch(() => {
        if (!cancelled) setHtml(`<p>Error: could not load content.</p>`);
      });
    return () => {
      cancelled = true;
    };
  }, [lesson]);

  if (!lesson) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        Select a lesson from the sidebar
      </div>
    );
  }

  const key = `${lesson.kind}/${lesson.folder}/${lesson.id}`;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={key}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto max-w-3xl px-8 py-10"
      >
        {html === null ? (
          <div className="space-y-3" aria-hidden>
            <div className="h-7 w-2/3 animate-pulse rounded bg-black/5 dark:bg-white/5" />
            <div className="h-4 w-full animate-pulse rounded bg-black/5 dark:bg-white/5" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-black/5 dark:bg-white/5" />
          </div>
        ) : (
          <HtmlRenderer html={html} />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
