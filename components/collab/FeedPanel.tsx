"use client";

import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/collab/Avatar";
import type { FeedItem } from "@/lib/collab/types";
import type { LessonRef } from "@/lib/vault/types";

// The home feed: what the reader sees when no document is open.
//
// One card per post, read top to bottom like a social feed: who and where,
// the note's title, then its own Overview section as the body. It only ever
// lists things the reader can already open (notes_feed decides that), so every
// card is a working link, never a teaser for something locked.

const PAGE = 20;

/** "3h", "2d", or a date — short, because the card is about the note. */
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The Overview arrives as lesson HTML. A card only needs paragraphs and inline
 * emphasis, so everything else is reduced to text: kept tags lose their
 * attributes, and any other tag is removed. That keeps the preview from
 * carrying scripts, styles or layout from the document into the feed.
 */
function overviewHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const KEEP = new Set(["P", "STRONG", "B", "EM", "I", "CODE"]);
  const clean = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? "").replace(/[&<>]/g, (c) =>
        c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"
      );
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as Element;
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return "";
    const inner = Array.from(el.childNodes).map(clean).join("");
    const tag = el.tagName.toLowerCase();
    if (KEEP.has(el.tagName)) return `<${tag}>${inner}</${tag}>`;
    // A blockquote or list still reads as its own paragraph.
    return /^(BLOCKQUOTE|LI|UL|OL|DIV)$/.test(el.tagName) ? `<p>${inner}</p>` : inner;
  };
  return Array.from(doc.body.childNodes).map(clean).join("");
}

export default function FeedPanel({
  onSelect,
  onOpenProfile,
}: {
  onSelect: (ref: LessonRef) => void;
  onOpenProfile: (username: string) => void;
}) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (before?: string) => {
    const params = new URLSearchParams({ limit: String(PAGE) });
    if (before) params.set("before", before);
    const res = await fetch(`/api/collab/feed?${params}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "could not load the feed");
    const page: FeedItem[] = data.items ?? [];
    setMore(page.length === PAGE);
    return page;
  }, []);

  useEffect(() => {
    load()
      .then(setItems)
      .catch((err) => {
        setError(err.message);
        setItems([]);
      });
  }, [load]);

  function open(item: FeedItem) {
    if (item.kind === "doc") {
      onSelect({ folder: item.folderSlug, id: item.docKey, kind: item.docKind });
    } else {
      onOpenProfile(item.ownerUsername);
    }
  }

  async function older() {
    if (!items?.length) return;
    setLoadingMore(true);
    try {
      const page = await load(items[items.length - 1].at);
      setItems((cur) => [...(cur ?? []), ...page]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[44rem] px-5 py-10 sm:px-8 sm:py-14">
      <h1 className="mb-8 text-2xl font-bold tracking-tight text-ink">Home</h1>

      {items === null ? (
        <div className="animate-pulse space-y-8" role="status" aria-label="Loading">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2.5">
              <div className="h-4 w-2/3 rounded bg-ink/[0.07]" />
              <div className="h-3 w-1/3 rounded bg-ink/[0.05]" />
              <div className="h-3 w-full rounded bg-ink/[0.05]" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="ui-empty">{error ?? "Nothing yet. New notes in your folders land here."}</p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {items.map((item, i) => (
              <li
                key={`${item.kind}:${item.folderSlug}:${item.kind === "doc" ? item.docKey : ""}:${item.at}`}
                style={{ animationDelay: `${Math.min(i, 6) * 25}ms` }}
                className="ui-rise relative min-w-0"
              >
                {/* The whole row is the link: a lesson or quiz opens in the
                    reader, a new folder opens its owner's profile. The name
                    inside stays its own link. */}
                <article
                  role="link"
                  tabIndex={0}
                  aria-label={
                    item.kind === "doc"
                      ? `${item.docKind === "quiz" ? "Take quiz" : item.docKind === "sheet" ? "Open cheatsheet" : "Read lesson"}: ${item.title}`
                      : `View ${item.folderName} on ${item.ownerUsername}'s profile`
                  }
                  onClick={() => open(item)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open(item);
                    }
                  }}
                  className="ui-row ui-focus -mx-3 block min-w-0 cursor-pointer break-words rounded-xl px-3 py-4 [overflow-wrap:anywhere]"
                >
                  <p className="text-base font-semibold leading-snug text-ink">
                    {item.kind === "doc" ? item.title : item.folderName}
                  </p>
                  <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenProfile(item.ownerUsername);
                      }}
                      aria-label={`Open ${item.ownerUsername}'s profile`}
                      className="ui-focus flex shrink-0 items-center gap-1.5 rounded font-medium text-ink-2 hover:text-accent"
                    >
                      <Avatar username={item.ownerUsername} avatarUrl={item.ownerAvatar} size={5} />
                      {item.ownerUsername}
                    </button>
                    <span aria-hidden>·</span>
                    <span className="min-w-0 truncate">
                      {item.kind === "doc" ? item.folderName : "New folder"}
                      {item.kind === "doc" && item.docKind !== "lesson" && ` · ${item.docKind === "sheet" ? "cheatsheet" : item.docKind}`}
                    </span>
                    <span aria-hidden>·</span>
                    <time dateTime={item.at} className="shrink-0">
                      {ago(item.at)}
                    </time>
                  </p>
                  {item.kind === "doc" && item.overview ? (
                    <div
                      className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-2 [&_code]:rounded [&_code]:bg-ink/5 [&_code]:px-1 [&_strong]:font-semibold [&_strong]:text-ink"
                      dangerouslySetInnerHTML={{ __html: overviewHtml(item.overview) }}
                    />
                  ) : item.kind === "folder" && item.description ? (
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-2">{item.description}</p>
                  ) : null}
                </article>
              </li>
            ))}
          </ul>
          {error && <p className="ui-empty mt-3">{error}</p>}
          {more && (
            <div className="mt-4">
              <button onClick={older} disabled={loadingMore} className="ui-btn ui-btn-sm ui-btn-text -ml-1">
                {loadingMore ? "Loading…" : "Show older"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
