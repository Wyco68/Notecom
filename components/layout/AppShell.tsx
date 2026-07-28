"use client";

import { useCallback, useEffect, useState } from "react";
import type { Folder, LessonRef, VaultTree } from "@/lib/vault/types";
import { pruneRecent, pushRecent, type RecentEntry } from "@/lib/vault/recent";
import {
  pruneFavorites,
  readFavorites,
  toggleFavorite,
  type FavoriteEntry,
} from "@/lib/vault/favorites";
import FileTree from "../sidebar/FileTree";
import RecentFiles from "../sidebar/RecentFiles";
import FavoriteFiles from "../sidebar/FavoriteFiles";
import SearchResults from "../sidebar/SearchResults";
import LessonViewer from "../viewer/LessonViewer";
import NewFolderModal from "../modals/NewFolderModal";
import GenerateModal from "../modals/GenerateModal";
import SignInModal from "../modals/SignInModal";
import ChatPanel from "../chat/ChatPanel";
import InvitationsInbox from "../collab/InvitationsInbox";
import TagGrantsInbox from "../collab/TagGrantsInbox";
import AccountControl from "../collab/AccountControl";
import ThemeToggle from "../theme/ThemeToggle";
import RefreshIcon from "../icons/RefreshIcon";
import SearchIcon from "../icons/SearchIcon";
import ChatIcon from "../icons/ChatIcon";
import MenuIcon from "../icons/MenuIcon";
import UploadIcon from "../icons/UploadIcon";

// Which write affordances the UI exposes: NEXT_PUBLIC_READ_ONLY covers a
// read-only reader box; the runtime readOnly flag from /api/tree covers a
// build where the env var was missing.
const READ_ONLY_UI = process.env.NEXT_PUBLIC_READ_ONLY === "1";

export default function AppShell() {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [selected, setSelected] = useState<LessonRef | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  // undefined until the first status check answers — avoids flashing a
  // "signed out" warning during the initial load.
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  const [showChat, setShowChat] = useState(false);
  // Hideable at every width: an off-canvas drawer below `lg`, a static column
  // from `lg` up. Starts closed and opens on wide screens after mount, since
  // the viewport isn't known during the server render.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  // Collaboration metadata for the local tree, keyed by folder slug. Stays
  // empty on a purely-local install, which keeps the sidebar flat.
  const [tagsByFolder, setTagsByFolder] = useState<Record<string, string[]>>({});
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  // Seed from the build-time env (fast path), then trust the runtime flag
  // /api/tree returns — so a read-only box hides controls even if the
  // client build was missing NEXT_PUBLIC_READ_ONLY.
  const [readOnly, setReadOnly] = useState(READ_ONLY_UI);

  const currentTitle = (() => {
    if (!selected || !folders) return null;
    const f = folders.find((f) => f.name === selected.folder);
    const list = selected.kind === "quiz" ? f?.quizzes : f?.lessons;
    return list?.find((l) => l.id === selected.id)?.title ?? null;
  })();

  // Tags live in Supabase while the tree comes from stored/SQLite, so they are
  // fetched separately and merged by slug. A failure here is normal (no
  // collaboration configured, signed out) and simply leaves the tree flat.
  const refreshTags = useCallback(async () => {
    try {
      const res = await fetch("/api/collab/my-folders");
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, string[]> = {};
      for (const f of data.folders ?? []) {
        if (f.tags?.length) map[f.slug] = f.tags;
      }
      setTagsByFolder(map);
    } catch {
      setTagsByFolder({});
    }
  }, []);

  const refreshTree = useCallback(async () => {
    const res = await fetch("/api/tree", { cache: "no-store" });
    const data: VaultTree = await res.json();
    const list = data.folders ?? [];
    setFolders(list);
    if (typeof data.readOnly === "boolean") setReadOnly(data.readOnly);
    // Drop recents and favourites whose file was deleted (here or on another
    // device) so neither list can offer a link that 404s.
    const stillExists = (e: { folder: string; id: string; kind: string }) => {
      const folder = list.find((f) => f.name === e.folder);
      const inList = e.kind === "quiz" ? folder?.quizzes : folder?.lessons;
      return !!inList?.some((l) => l.id === e.id);
    };
    setRecent(pruneRecent(stillExists));
    setFavorites(pruneFavorites(stillExists));
    refreshTags();
  }, [refreshTags]);

  // Record what the user opens, once the title is known. Runs on selection
  // change rather than inside onSelect because the title comes from the tree.
  useEffect(() => {
    if (selected && currentTitle) setRecent(pushRecent(selected, currentTitle));
  }, [selected, currentTitle]);

  // localStorage is not readable during render (no server equivalent), so the
  // first paint has no favourites and this fills them in after mount.
  useEffect(() => {
    setFavorites(readFavorites());
  }, []);

  const onToggleFavorite = useCallback(
    (ref: LessonRef, title: string) => setFavorites(toggleFavorite(ref, title)),
    []
  );

  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) setSidebarOpen(true);
  }, []);

  // On a narrow screen the drawer covers the document it just opened, so it
  // closes with the selection; a static sidebar stays put.
  const onSelect = useCallback((ref: LessonRef) => {
    setSelected(ref);
    if (!window.matchMedia("(min-width: 1024px)").matches) setSidebarOpen(false);
  }, []);

  // Membership test the tree rows use, precomputed once per render.
  const favoriteKeys = new Set(favorites.map((f) => `${f.kind}:${f.folder}:${f.id}`));

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshTree();
    } finally {
      setRefreshing(false);
    }
  }, [refreshTree]);

  useEffect(() => {
    refreshTree();
  }, [refreshTree]);

  // Generating runs the local Claude Code CLI, so a signed-out session is a
  // dead end the user should see before they upload a file, not after a run
  // burns a few minutes and fails.
  const refreshAuth = useCallback(async () => {
    if (readOnly) return;
    try {
      const res = await fetch("/api/auth");
      setSignedIn(res.ok ? (await res.json()).loggedIn : false);
    } catch {
      setSignedIn(false);
    }
  }, [readOnly]);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  // Lessons and quizzes are written to the vault by Claude Code (/lect, /quiz)
  // outside this app, so the tree can go stale while the window is in the
  // background. Re-fetch when the user returns to the window (or the tab
  // becomes visible) so a just-added quiz/folder shows up without a manual
  // reload.
  useEffect(() => {
    const onFocus = () => refreshTree();
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshTree();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshTree]);

  return (
    <div className="flex h-dvh overflow-hidden">
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          aria-hidden
        />
      )}

      {/* One fixed width, wide enough for the names it holds. It never reflows
          with its contents: a sidebar that resizes as rows open or hover is
          the reader jumping sideways for no reason. Long names wrap instead. */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-80 max-w-[85vw] shrink-0 flex-col border-r border-black/10 bg-gray-50 transition-transform duration-200 lg:static lg:z-auto lg:max-w-none lg:translate-x-0 dark:border-white/10 dark:bg-[#0a0e14] ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:hidden"
        }`}
      >
        <div className="flex items-center justify-between border-b border-black/10 px-3 py-3 dark:border-white/10">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-200">
            Notecom
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSidebarOpen(false)}
              title="Hide sidebar"
              className="flex h-7 w-7 items-center justify-center rounded text-gray-500 hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/10"
            >
              ✕
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh or push to database"
              className="flex h-7 w-7 items-center justify-center rounded text-gray-500 hover:bg-black/5 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/10"
            >
              <RefreshIcon className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <ThemeToggle />
          </div>
        </div>

        <div className="px-3 pt-3">
          <div className="flex items-center gap-2 rounded border border-black/10 bg-white px-2 py-1.5 dark:border-white/10 dark:bg-white/5">
            <SearchIcon className="h-3.5 w-3.5 shrink-0 text-gray-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes..."
              className="w-full bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-500 dark:text-gray-200"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                title="Clear search"
                className="shrink-0 rounded px-1 text-xs text-gray-500 hover:bg-black/5 dark:hover:bg-white/10"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Renders nothing unless the user actually has invitations, and
            nothing at all when collaboration isn't configured. */}
        <InvitationsInbox onChanged={refreshTree} />

        {/* Tags offered by people the user follows. Accepting one is what
            grants access to the folders carrying it. */}
        <TagGrantsInbox onChanged={refreshTree} />

        {!query.trim() && (
          <FavoriteFiles
            entries={favorites}
            selected={selected}
            onSelect={onSelect}
            onToggle={onToggleFavorite}
          />
        )}

        {!query.trim() && (
          <RecentFiles entries={recent} selected={selected} onSelect={onSelect} />
        )}

        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
            {query.trim() ? "Results" : "Folders"}
          </span>
          {!query.trim() && !readOnly && (
            <div className="flex items-center gap-1">
              {/* Generating needs a Claude Code session, so when there isn't
                  one the button that starts one takes its place — offering
                  Generate first would only lead to a run that fails on auth. */}
              {signedIn === false ? (
                <button
                  onClick={() => setShowSignIn(true)}
                  title="Claude Code is signed out — generating notes needs a session"
                  className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/70"
                >
                  Sign in
                </button>
              ) : (
                <button
                  onClick={() => setShowGenerate(true)}
                  title="Generate a lesson or quiz from a file (runs local Claude Code)"
                  className="flex h-5 w-5 items-center justify-center rounded text-gray-600 hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10"
                >
                  <UploadIcon className="h-3.5 w-3.5" />
                </button>
              )}
              <a
                href="/discover"
                title="Discover folders shared by other people"
                className="flex h-5 w-5 items-center justify-center rounded text-gray-600 hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10"
              >
                <SearchIcon className="h-3.5 w-3.5" />
              </a>
              <button
                onClick={() => setShowNewFolder(true)}
                title="New Folder"
                className="flex h-5 w-5 items-center justify-center rounded text-gray-600 hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10"
              >
                +
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {query.trim() ? (
            <SearchResults query={query.trim()} onSelect={onSelect} />
          ) : (
            <FileTree
              folders={folders}
              selected={selected}
              tagsByFolder={tagsByFolder}
              favorites={favoriteKeys}
              onSelect={onSelect}
              onToggleFavorite={onToggleFavorite}
              onChanged={refreshTree}
            />
          )}
        </div>

        {/* Sidebar foot: collaboration account. Renders nothing when the app
            isn't configured for collaboration. */}
        <AccountControl />
      </aside>

      <main
        className={`relative flex-1 overflow-y-auto bg-white dark:bg-[#0d1117] ${
          sidebarOpen ? "pt-12 lg:pt-0" : "pt-12"
        }`}
      >
        <LessonViewer lesson={selected} />
      </main>

      {/* The only way back to a hidden sidebar, at every width. */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          title="Show sidebar"
          className="fixed left-3 top-3 z-30 flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white text-gray-500 shadow-sm hover:bg-black/5 hover:text-blue-600 dark:border-white/10 dark:bg-[#161b22] dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-blue-400"
        >
          <MenuIcon className="h-4 w-4" />
        </button>
      )}

      <button
        onClick={() => setShowChat(true)}
        title="Ask My Notes — chat over your lessons (local model)"
        className="fixed right-5 top-3 z-40 flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white text-gray-500 shadow-sm hover:bg-black/5 hover:text-blue-600 dark:border-white/10 dark:bg-[#161b22] dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-blue-400"
      >
        <ChatIcon className="h-4 w-4" />
      </button>

      {showChat && (
        <ChatPanel
          current={selected}
          currentTitle={currentTitle}
          onClose={() => setShowChat(false)}
        />
      )}

      {showNewFolder && (
        <NewFolderModal
          onClose={() => setShowNewFolder(false)}
          onCreated={refreshTree}
        />
      )}

      {showGenerate && (
        <GenerateModal
          folders={folders ?? []}
          onClose={() => setShowGenerate(false)}
          onGenerated={refreshTree}
          onSignIn={() => {
            setShowGenerate(false);
            setShowSignIn(true);
          }}
        />
      )}

      {showSignIn && (
        <SignInModal
          onClose={() => {
            setShowSignIn(false);
            // The user may have signed in from a terminal meanwhile; re-check
            // rather than trusting the modal's own outcome.
            refreshAuth();
          }}
          onSignedIn={refreshAuth}
        />
      )}
    </div>
  );
}
