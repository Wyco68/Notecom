"use client";

import { useCallback, useEffect, useState } from "react";
import FolderCard from "@/components/collab/FolderCard";
import SearchIcon from "@/components/icons/SearchIcon";
import SpinnerIcon from "@/components/icons/SpinnerIcon";
import type { FolderSummary } from "@/lib/collab/types";

// Folder discovery. Search covers name, description and owner username — not
// tags, which are access grants now and would otherwise let anyone enumerate
// the folders a tag unlocks. Which folders are eligible at all is decided by
// notes_search_folders, so a non-discoverable folder never arrives here.
export default function DiscoverPage() {
  const [q, setQ] = useState("");
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/collab/discover?${params}`);
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
  }, [q]);

  // Debounced so typing doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(search, 250);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Discover folders</h1>
        <a href="/vault" className="text-sm text-blue-500 hover:text-blue-400">
          Back to vault
        </a>
      </div>

      <div className="relative mb-4">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          <SearchIcon className="h-4 w-4" />
        </span>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, description or owner"
          className="w-full rounded-lg border border-black/10 bg-gray-50 py-2.5 pl-10 pr-3 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
        />
      </div>


      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {needsAuth ? (
        <div className="py-16 text-center">
          <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
            Sign in to discover and join folders.
          </p>
          <a
            href="/auth/sign-in?next=/discover"
            className="inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Sign in
          </a>
        </div>
      ) : loading ? (
        <div className="flex justify-center py-16 text-gray-400">
          <SpinnerIcon className="h-6 w-6" />
        </div>
      ) : folders.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
          No folders match.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {folders.map((f) => (
            <FolderCard key={f.id} folder={f} onJoined={search} />
          ))}
        </div>
      )}
    </main>
  );
}
