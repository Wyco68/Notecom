"use client";

import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/collab/Avatar";
import { SkeletonCard } from "@/components/layout/Skeleton";
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
    <div className="w-full px-4 py-6 sm:px-8 sm:py-8 lg:px-16 lg:py-10 xl:px-24">
      <h1 className="mb-1 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
        Home
      </h1>
      <p className="mb-8 text-sm text-gray-500 dark:text-gray-400">
        New notes in your folders, and folders published by people you follow.
      </p>

      {items === null ? (
        <div className="grid grid-cols-1 gap-5 sm:gap-6 lg:gap-8">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
        </div>
      ) : items.length === 0 ? (
        <p className="ui-empty">
          {error ?? "Nothing yet. Notes added to your folders will show up here."}
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-5 sm:gap-6 lg:gap-8">
            {items.map((item, i) => (
              <li
                key={`${item.kind}:${item.folderSlug}:${item.kind === "doc" ? item.docKey : ""}:${item.at}`}
                style={{ animationDelay: `${Math.min(i, 6) * 25}ms` }}
                className="min-w-0"
              >
                {/* The whole card is the link: a lesson or quiz opens in the reader, a
                    new folder opens its owner's profile. The profile photo and name
                    inside stay their own links, so they stop the click from also
                    opening the post. */}
                <article
                  role="link"
                  tabIndex={0}
                  aria-label={
                    item.kind === "doc"
                      ? `${item.docKind === "quiz" ? "Take quiz" : "Read lesson"}: ${item.title}`
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
                  className="ui-rise ui-card ui-card-hover ui-focus min-w-0 cursor-pointer overflow-hidden break-words bg-white p-0 [overflow-wrap:anywhere] dark:bg-[#161b22]"
                >
                  {/* Header, as a post: small round photo, name, then where and when. */}
                  <header className="flex items-center gap-3 px-4 pt-4 sm:px-6 sm:pt-5 lg:px-8 lg:pt-6">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenProfile(item.ownerUsername);
                      }}
                      aria-label={`Open ${item.ownerUsername}'s profile`}
                      className="ui-focus shrink-0 rounded-full"
                    >
                      <Avatar username={item.ownerUsername} avatarUrl={item.ownerAvatar} size={8} />
                    </button>
                    <div className="min-w-0 flex-1 leading-tight">
                      <p className="truncate text-sm">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenProfile(item.ownerUsername);
                          }}
                          className="ui-focus rounded font-semibold text-gray-900 hover:underline dark:text-gray-100"
                        >
                          {item.ownerUsername}
                        </button>
                        <span className="text-gray-500 dark:text-gray-400">
                          {" · "}
                          {item.kind === "doc" ? item.folderName : "new folder"}
                        </span>
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        <time dateTime={item.at}>{ago(item.at)}</time>
                        {item.kind === "doc" && ` · ${item.docKind}`}
                      </p>
                    </div>
                  </header>

                  {/* Caption: the title, like a post's text line. */}
                  <p className="px-4 pb-4 pt-3 text-sm font-medium text-gray-900 sm:px-6 sm:pb-5 sm:text-base lg:px-8 lg:pb-6 lg:text-lg dark:text-gray-100">
                    {item.kind === "doc" ? item.title : item.folderName}
                  </p>

                  {/* Media: the Overview (or folder description) as the post's full-width body. */}
                  {item.kind === "doc" && item.overview ? (
                    <section className="relative border-t border-black/5 bg-gray-50 px-5 py-5 sm:px-8 sm:py-7 lg:px-10 lg:py-9 dark:border-white/10 dark:bg-black">
                      <h3 className="mb-3 text-base font-semibold text-violet-600 sm:text-lg lg:text-xl dark:text-violet-300">
                        Overview
                      </h3>
                      <div
                        className="max-h-48 space-y-3 overflow-hidden text-sm leading-relaxed sm:max-h-72 sm:space-y-4 sm:text-[15px] lg:max-h-96 lg:text-base text-gray-700 dark:text-gray-300 [&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1 dark:[&_code]:bg-white/10 [&_strong]:font-semibold [&_strong]:text-gray-900 dark:[&_strong]:text-gray-100"
                        dangerouslySetInnerHTML={{ __html: overviewHtml(item.overview) }}
                      />
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-gray-50 dark:from-black"
                      />
                    </section>
                  ) : item.kind === "folder" && item.description ? (
                    <section className="border-t border-black/5 bg-gray-50 px-5 py-5 text-sm leading-relaxed sm:px-8 sm:py-7 sm:text-[15px] lg:px-10 lg:py-9 lg:text-base text-gray-700 dark:border-white/10 dark:bg-black dark:text-gray-300">
                      {item.description}
                    </section>
                  ) : null}

                </article>
              </li>
            ))}
          </ul>
          {error && <p className="ui-empty mt-3">{error}</p>}
          {more && (
            <button
              onClick={older}
              disabled={loadingMore}
              className="ui-btn ui-btn-sm ui-btn-secondary mt-6"
            >
              {loadingMore ? "Loading..." : "Show older"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
