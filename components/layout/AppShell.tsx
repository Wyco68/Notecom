"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import GenerateJobList from "../generate/GenerateJobList";
import { useGenerateJobs } from "../generate/GenerateJobsProvider";
import InvitationsInbox from "../collab/InvitationsInbox";
import TagGrantsInbox from "../collab/TagGrantsInbox";
import AccountControl from "../collab/AccountControl";
import AccountPanel from "../account/AccountPanel";
import FolderManagePanel from "../collab/FolderManagePanel";
import ThemeToggle from "../theme/ThemeToggle";
import RefreshIcon from "../icons/RefreshIcon";
import SearchIcon from "../icons/SearchIcon";
import MenuIcon from "../icons/MenuIcon";
import UploadIcon from "../icons/UploadIcon";

export default function AppShell() {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [selected, setSelected] = useState<LessonRef | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  // `true` opens the form; a job id opens that run's log instead.
  const [showGenerate, setShowGenerate] = useState<boolean | string>(false);
  const [showSignIn, setShowSignIn] = useState(false);
  // What the content column is showing instead of the document. The account
  // editor and the sharing console both take it over rather than navigating
  // away, so opening either doesn't tear down the workspace and closing it puts
  // the reader back on the document they left. One value, not a boolean each:
  // two panes cannot be open at once, and this is what says so.
  const [overlay, setOverlay] = useState<
    { kind: "profile" } | { kind: "manage"; slug: string } | null
  >(null);
  // undefined until the first status check answers — avoids flashing a
  // "signed out" warning during the initial load.
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
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
  // Generation jobs are owned above this component so they survive the dialog
  // closing; this only reads them.
  const { completedTick } = useGenerateJobs();

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

  // The document on screen, held so it can be filed under "Recent" when the
  // reader leaves it. A ref, not state: it must not trigger a render, and the
  // unload handler below has to read the latest value without re-subscribing.
  const openDoc = useRef<{ ref: LessonRef; title: string } | null>(null);

  const refKey = (r: { kind: string; folder: string; id: string }) =>
    `${r.kind}:${r.folder}:${r.id}`;

  // Recent means "finished with", not "opened": an entry is written when the
  // open document is replaced or closed, so the file being read is never also
  // listed as history. The title comes from the tree, which is why this runs on
  // selection change rather than inside onSelect.
  useEffect(() => {
    const next = selected && currentTitle ? { ref: selected, title: currentTitle } : null;
    const open = openDoc.current;
    if ((open && next && refKey(open.ref) === refKey(next.ref)) || (!open && !next)) return;
    if (open) setRecent(pushRecent(open.ref, open.title));
    openDoc.current = next;
  }, [selected, currentTitle]);

  // Closing the window or tab is also leaving the document. `pagehide` fires in
  // cases `beforeunload` misses (a mobile background, a back-forward cache), and
  // only the localStorage write matters here — the component is going away, so
  // there is nothing to re-render.
  useEffect(() => {
    const flush = () => {
      if (openDoc.current) {
        pushRecent(openDoc.current.ref, openDoc.current.title);
        openDoc.current = null;
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

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
  // closes with the selection; a static sidebar stays put. Picking a document is
  // also how the reader dismisses the account editor.
  const onSelect = useCallback((ref: LessonRef) => {
    setSelected(ref);
    setOverlay(null);
    if (!window.matchMedia("(min-width: 1024px)").matches) setSidebarOpen(false);
  }, []);

  // Both overlays are opened from the sidebar, which on a narrow screen is
  // covering the column they render into.
  const openOverlay = useCallback(
    (next: { kind: "profile" } | { kind: "manage"; slug: string }) => {
      setOverlay(next);
      if (!window.matchMedia("(min-width: 1024px)").matches) setSidebarOpen(false);
    },
    []
  );

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

  // A finished run wrote a file into vault/; the next tree fetch is what ingests
  // it into SQLite. The dialog used to trigger this, which meant closing it lost
  // the refresh — the job itself announces completion now, wherever the reader
  // happens to be.
  useEffect(() => {
    if (completedTick) refreshTree();
  }, [completedTick, refreshTree]);

  // Generating runs the local Claude Code CLI, so a signed-out session is a
  // dead end the user should see before they upload a file, not after a run
  // burns a few minutes and fails.
  const refreshAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth");
      setSignedIn(res.ok ? (await res.json()).loggedIn : false);
    } catch {
      setSignedIn(false);
    }
  }, []);

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
          <span className="text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-200">
            Notecom
          </span>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setSidebarOpen(false)}
              title="Hide sidebar"
              className="ui-icon-btn h-7 w-7 text-xs"
            >
              ✕
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh or push to database"
              className="ui-icon-btn h-7 w-7"
            >
              <RefreshIcon className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <ThemeToggle />
          </div>
        </div>

        <div className="px-3 pt-3">
          {/* The field is the wrapper, so the whole box takes the focus ring
              rather than the bare input inside it. */}
          <div className="ui-field flex items-center gap-2 px-2.5 py-1.5 focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/25 dark:focus-within:border-blue-500 dark:focus-within:ring-blue-500/25">
            <SearchIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes..."
              className="w-full bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:text-gray-200 dark:placeholder:text-gray-500"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                title="Clear search"
                className="ui-icon-btn h-5 w-5 text-xs"
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

        {/* Generation runs in the background, so this row is what a closed
            dialog leaves behind: proof the run is alive, and the way back into
            its log. Renders nothing when nothing is running. */}
        <GenerateJobList onOpen={(jobId) => setShowGenerate(jobId)} />

        {!query.trim() && (
          <FavoriteFiles
            entries={favorites}
            selected={selected}
            onSelect={onSelect}
            onToggle={onToggleFavorite}
          />
        )}

        {/* Folders takes whatever height is left; Recent sits under it at a
            fixed height — exactly the eight rows its history is capped at
            (h-56 = 8 × 1.75rem), so it neither grows with the list nor leaves a
            gap when the list is short. A long file name truncates inside its
            row rather than widening it, which is what keeps the fixed-width
            sidebar from scrolling sideways. While a search is running the
            results take the whole area, since Recent is hidden then anyway. */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between px-3 pb-1 pt-4">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
                {query.trim() ? "Results" : "Folders"}
              </span>
              {!query.trim() && (
                <div className="flex items-center gap-0.5">
                  {/* Generating needs a Claude Code session, so when there isn't
                      one the button that starts one takes its place — offering
                      Generate first would only lead to a run that fails on auth. */}
                  {signedIn === false ? (
                    <button
                      onClick={() => setShowSignIn(true)}
                      title="Claude Code is signed out — generating notes needs a session"
                      className="ui-btn ui-btn-xs rounded border border-amber-500/30 bg-amber-500/10 font-medium text-amber-700 hover:bg-amber-500/20 focus-visible:ring-amber-500/70 dark:text-amber-300"
                    >
                      Sign in
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowGenerate(true)}
                      title="Generate a lesson or quiz from a file (runs local Claude Code)"
                      className="ui-icon-btn h-6 w-6"
                    >
                      <UploadIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <a
                    href="/discover"
                    title="Discover folders shared by other people"
                    className="ui-icon-btn h-6 w-6"
                  >
                    <SearchIcon className="h-3.5 w-3.5" />
                  </a>
                  <button
                    onClick={() => setShowNewFolder(true)}
                    title="New Folder"
                    className="ui-icon-btn h-6 w-6 text-base leading-none"
                  >
                    +
                  </button>
                </div>
              )}
            </div>

            <div className="ui-scroll flex-1 px-2 pb-2">
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
                  onManage={(slug) => openOverlay({ kind: "manage", slug })}
                />
              )}
            </div>
          </div>

          {!query.trim() && (
            <div className="flex shrink-0 flex-col border-t border-black/10 pb-2 dark:border-white/10">
              <span className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
                Recent
              </span>
              {/* h-56 (14rem) is exactly the eight rows recent.ts caps the list
                  at — 8 × 1.75rem, a row being text-sm's 1.25rem line plus py-1.
                  No padding inside the box, or it would eat a row. Still
                  scrollable, so a longer list left in localStorage by an older
                  build stays reachable rather than clipped; and while the list
                  is empty the box collapses instead of holding open eight rows
                  of blank space. */}
              <div className={`px-2 ${recent.length ? "ui-scroll h-56" : ""}`}>
                <RecentFiles entries={recent} selected={selected} onSelect={onSelect} />
              </div>
            </div>
          )}
        </div>

        {/* Sidebar foot: collaboration account. Renders nothing when the app
            isn't configured for collaboration. */}
        <AccountControl
          onOpenProfile={() => openOverlay({ kind: "profile" })}
          active={overlay?.kind === "profile"}
        />
      </aside>

      <main
        className={`ui-scroll relative flex-1 bg-white dark:bg-[#0d1117] ${
          sidebarOpen ? "pt-12 lg:pt-0" : "pt-12"
        }`}
      >
        {/* The account editor and the sharing console live here rather than at
            /account and /vault/[folder]/manage: the reader keeps their place,
            and closing either returns to the same document. Keyed by slug so
            switching folders remounts the console instead of showing the
            previous folder's state while the new one loads. */}
        {overlay?.kind === "profile" ? (
          <AccountPanel onClose={() => setOverlay(null)} />
        ) : overlay?.kind === "manage" ? (
          <FolderManagePanel
            key={overlay.slug}
            slug={overlay.slug}
            onClose={() => setOverlay(null)}
            onDeleted={() => {
              setOverlay(null);
              // The deleted folder may be holding the open document.
              if (selected?.folder === overlay.slug) setSelected(null);
              refreshTree();
            }}
          />
        ) : (
          <LessonViewer lesson={selected} />
        )}
      </main>

      {/* The only way back to a hidden sidebar, at every width. */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          title="Show sidebar"
          className="ui-icon-btn fixed left-3 top-3 z-30 h-8 w-8 rounded-full border border-black/10 bg-white shadow-sm hover:text-blue-600 dark:border-white/10 dark:bg-[#161b22] dark:hover:text-blue-400"
        >
          <MenuIcon className="h-4 w-4" />
        </button>
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
          watchJobId={typeof showGenerate === "string" ? showGenerate : undefined}
          onClose={() => setShowGenerate(false)}
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
