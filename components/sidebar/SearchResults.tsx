"use client";

import { useEffect, useRef, useState } from "react";
import type { LessonRef } from "@/lib/vault/types";
import { SkeletonRows } from "../layout/Skeleton";

interface Result {
  folder: string;
  id: string;
  kind: "lesson" | "quiz";
  title: string;
  topic: string;
  heading: string;
  summary: string;
  headingIndex: number;
  score: number;
}

type State =
  | { status: "loading" }
  | { status: "offline" }
  | { status: "done"; mode: string; results: Result[] };

// Wrap query terms in a red-tinted mark so the eye finds why a result
// matched. Terms are regex-escaped; single-char terms skipped (too noisy).
function highlight(text: string, query: string) {
  const terms = query
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (terms.length === 0) return text;
  const re = new RegExp(`(${terms.join("|")})`, "giu");
  const parts = text.split(re);
  if (parts.length === 1) return text;
  // split with one capture group interleaves: even = between, odd = match
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark
        key={i}
        className="rounded-sm bg-red-500/20 px-0.5 text-red-700 dark:text-red-300"
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export default function SearchResults({
  query,
  onSelect,
}: {
  query: string;
  onSelect: (ref: LessonRef) => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    setState({ status: "loading" });
    const controller = new AbortController();
    debounce.current = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}&limit=12`, {
        signal: controller.signal,
      })
        .then(async (r) => {
          if (!r.ok) throw new Error("offline");
          const data = await r.json();
          setState({ status: "done", mode: data.mode, results: data.results ?? [] });
        })
        .catch((err) => {
          if (err.name !== "AbortError") setState({ status: "offline" });
        });
    }, 250);
    return () => {
      controller.abort();
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  if (state.status === "loading") {
    // A result is a heading over a subtitle, so the placeholder is too — the
    // list doesn't jump when the real hits replace it.
    return <SkeletonRows rows={5} lines={2} />;
  }

  if (state.status === "offline") {
    return (
      <p className="px-2 py-2 text-sm text-gray-500">
        Search index is offline. Start it with{" "}
        <code className="rounded border border-black/10 bg-black/[0.04] px-1 py-0.5 text-xs dark:border-white/10 dark:bg-white/[0.06]">
          node scripts/ensure-indexd.mjs
        </code>
      </p>
    );
  }

  if (state.results.length === 0) {
    return (
      <p className="px-2 py-2 text-sm text-gray-500">
        Nothing in your notes matches &quot;{query}&quot;.
      </p>
    );
  }

  return (
    <div>
      {state.results.map((r, i) => (
        <button
          key={`${r.kind}/${r.folder}/${r.id}/${i}`}
          onClick={() =>
            onSelect({
              folder: r.folder,
              id: r.id,
              kind: r.kind,
              heading: r.heading,
              headingIndex: r.headingIndex,
            })
          }
          style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}
          className="ui-rise ui-row block w-full px-2 py-1.5 text-left"
        >
          <span className="block truncate text-sm text-gray-800 dark:text-gray-200">
            {highlight(r.heading, query)}
          </span>
          <span className="block truncate text-xs text-gray-500">
            {r.title} · {r.folder.replace(/-/g, " ")}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-gray-600 dark:text-gray-400">
            {highlight(r.summary, query)}
          </span>
        </button>
      ))}
    </div>
  );
}
