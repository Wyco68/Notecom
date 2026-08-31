"use client";

import { useCallback, useState } from "react";
import FolderCard from "@/components/collab/FolderCard";
import SearchIcon from "@/components/icons/SearchIcon";
import PanelHeader from "@/components/layout/PanelHeader";
import { SkeletonCard } from "@/components/layout/Skeleton";
import type { FolderSummary } from "@/lib/collab/types";

// Folder discovery. Search covers name, description and owner username — not
// tags, which are access grants now and would otherwise let anyone enumerate
// the folders a tag unlocks. Which folders are eligible at all is decided by
// notes_search_folders, so a non-discoverable folder never arrives here.
//
// Rendered in two places from one definition, like AccountPanel: inside the
// workspace's content column (AppShell, with `onClose`) and as the standalone
// /discover page (no `onClose`, which is what a deep link lands on).
export default function DiscoverPanel({
  onClose,
  onJoined,
}: {
  onClose?: () => void;
  /** A folder was joined — the tree behind this panel has a new entry. */
  onJoined?: () => void;
}) {
  const [q, setQ] = useState("");
  // The submitted term — empty string means "never searched" as well as "just
  // cleared", and both show nothing. This is a search box, not a directory:
  // there is deliberately no browse-all default.
  const [submitted, setSubmitted] = useState("");
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  const runSearch = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/collab/discover?q=${encodeURIComponent(term)}`);
      if (res.status === 401) {
        setNeedsAuth(true);
        setFolders([]);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "search failed");
      setNeedsAuth(false);
      setFolders(data.folders ?? []);
    } catch (err: any) {
      setError(err.message);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const submit = useCallback(() => {
    const term = q.trim();
    setSubmitted(term);
    if (!term) {
      setFolders([]);
      return;
    }
    runSearch(term);
  }, [q, runSearch]);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-8">
      <PanelHeader
        title="Discover folders"
        subtitle="Search by name, description or owner — public folders and your own."
        onClose={onClose}
      />

      <div className="relative mb-6">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          <SearchIcon className="h-4 w-4" />
        </span>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Search by name, description or owner — press Enter"
          className="ui-field py-2.5 pl-10 pr-3"
        />
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {needsAuth ? (
        <div className="py-16 text-center">
          <p className="mb-3 ui-empty">
            Sign in to discover and join folders.
          </p>
          <a href="/auth/sign-in?next=/discover" className="ui-btn ui-btn-primary px-4">
            Sign in
          </a>
        </div>
      ) : loading ? (
        // Placeholder cards in the real grid, so results drop into the layout
        // they were already occupying.
        <div className="grid animate-pulse gap-4 sm:grid-cols-2" role="status" aria-label="Loading">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
      ) : !submitted ? (
        <p className="py-16 text-center ui-empty">
          Search for a folder by name, description or owner.
        </p>
      ) : folders.length === 0 ? (
        <p className="py-16 text-center ui-empty">
          No folders match &quot;{submitted}&quot;.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {folders.map((f) => (
            <FolderCard
              key={f.id}
              folder={f}
              onJoined={() => {
                runSearch(submitted);
                onJoined?.();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
