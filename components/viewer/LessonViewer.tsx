"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { LessonRef } from "@/lib/vault/types";
import HtmlRenderer from "./HtmlRenderer";

export default function LessonViewer({ lesson }: { lesson: LessonRef | null }) {
  const [html, setHtml] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const loadedDoc = useRef<string | null>(null);

  useEffect(() => {
    if (!lesson) {
      setHtml(null);
      loadedDoc.current = null;
      return;
    }
    const docKey = `${lesson.kind}/${lesson.folder}/${lesson.id}`;
    // Same document, different search hit — keep the rendered HTML and let
    // the scroll effect below handle the jump instead of re-fetching.
    if (loadedDoc.current === docKey) return;
    // Guard against a fast lesson switch: an earlier fetch resolving after a
    // later one would otherwise leave the wrong lesson on screen.
    let cancelled = false;
    setHtml(null);
    const base =
      lesson.kind === "quiz"
        ? "/api/quiz"
        : lesson.kind === "assignment"
        ? "/api/assignment"
        : "/api/lesson";
    fetch(
      `${base}/${encodeURIComponent(lesson.folder)}/${encodeURIComponent(lesson.id)}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setHtml(data.html ?? `<p>Error: ${data.error ?? "not found"}</p>`);
          loadedDoc.current = docKey;
        }
      })
      .catch(() => {
        if (!cancelled) setHtml(`<p>Error: could not load content.</p>`);
      });
    return () => {
      cancelled = true;
    };
  }, [lesson]);

  // Jump to the section a search hit came from: the headingIndex-th h2/h3
  // whose text matches (headings like "How it Works" repeat per concept,
  // so text alone isn't enough). Brief highlight so the eye lands on it.
  useEffect(() => {
    if (!html || !lesson?.heading || !containerRef.current) return;
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const target = norm(lesson.heading);
    const matches = Array.from(
      containerRef.current.querySelectorAll<HTMLElement>("h2, h3")
    ).filter((el) => norm(el.textContent ?? "") === target);
    const el = matches[lesson.headingIndex ?? 0] ?? matches[0];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("bg-blue-600/20", "rounded", "transition-colors", "duration-700");
    const t = setTimeout(() => el.classList.remove("bg-blue-600/20"), 1600);
    return () => clearTimeout(t);
  }, [html, lesson]);

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
        ref={containerRef}
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
