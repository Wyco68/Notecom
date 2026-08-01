"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Folder, FolderDocs, LessonRef, VaultTree } from "@/lib/vault/types";
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
import FollowRequestsInbox from "../collab/FollowRequestsInbox";
import AccountControl from "../collab/AccountControl";
import AccountPanel from "../account/AccountPanel";
import DiscoverPanel from "../collab/DiscoverPanel";
import PeoplePanel from "../collab/PeoplePanel";
import FolderManagePanel from "../collab/FolderManagePanel";
import ThemeToggle from "../theme/ThemeToggle";
import RefreshIcon from "../icons/RefreshIcon";
import SearchIcon from "../icons/SearchIcon";
import UserIcon from "../icons/UserIcon";
import MenuIcon from "../icons/MenuIcon";
import UploadIcon from "../icons/UploadIcon";

export default function AppShell() {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  // Documents, per folder, fetched the first time a folder is opened. An
  // absent key means "not fetched yet", which is what the tree draws a
  // placeholder for — it is not the same as a folder with no lessons.
  const [docs, setDocs] = useState<Record<string, FolderDocs>>({});
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
    | { kind: "profile" }
    | { kind: "discover" }
    | { kind: "people" }
    | { kind: "manage"; slug: string }
    | null
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
  // The submitted search term — separate from `query` (the live input value)
  // because search now waits for Enter instead of firing per keystroke, and an
  // empty search must show nothing rather than everything.
  const [submittedQuery, setSubmittedQuery] = useState("");
  // Collaboration metadata for the local tree, keyed by folder slug. Stays
  // empty on a purely-local install, which keeps the sidebar flat.
  const [tagsByFolder, setTagsByFolder] = useState<Record<string, string[]>>({});
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  // Generation jobs are owned above this component so they survive the dialog
  // closing; this only reads them.
  const { completedTick } = useGenerateJobs();

  // Null until the open document's folder has been fetched, which is why
  // onSelect asks for it: the title is what files the document under "Recent".
  const currentTitle = (() => {
    if (!selected) return null;
    const d = docs[selected.folder];
    const list = selected.kind === "quiz" ? d?.quizzes : d?.lessons;
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

  // The document cache, readable from callbacks that must not re-subscribe when
  // it changes — `refreshTree` re-reads every folder already fetched, and would
  // otherwise be a new function on every fetch, re-running the effects that
  // depend on it. The state above is the render copy; this is the current one.
  const docsRef = useRef<Record<string, FolderDocs>>({});
  // Folders with a request in flight, so an open, a re-render and a refresh
  // don't each fire their own.
  const loading = useRef<Set<string>>(new Set());

  const fetchDocs = useCallback(async (name: string) => {
    if (loading.current.has(name)) return;
    loading.current.add(name);
    try {
      const res = await fetch(`/api/folders/${encodeURIComponent(name)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data: FolderDocs = await res.json();
      docsRef.current = {
        ...docsRef.current,
        [name]: { lessons: data.lessons ?? [], quizzes: data.quizzes ?? [] },
      };
      setDocs(docsRef.current);
    } catch {
      // Leave the folder unfetched rather than caching an empty one: the row
      // keeps its placeholder, and the next open (or refresh) tries again.
    } finally {
      loading.current.delete(name);
    }
  }, []);

  // Called when a folder is opened, and for the folder holding the selection.
  // Idempotent — a folder already fetched costs nothing.
  const openFolder = useCallback(
    (name: string) => {
      if (docsRef.current[name]) return;
      fetchDocs(name);
    },
    [fetchDocs]
  );

  // Re-reads the folder list and prunes recents/favourites against it — one
  // request, regardless of how many folders the reader has open. This is the
  // automatic path (focus, visibility, the interval below): it answers "did a
  // folder appear or disappear" without paying for every open folder's
  // documents or the tag list on every check.
  //
  // `passive` is only true for the focus/visibility auto-check below, where a
  // few seconds of staleness is fine — it lets the browser reuse a cached
  // response instead of forcing a Supabase round trip on every alt-tab (the
  // route's own `stale-while-revalidate`, see app/api/tree/route.ts). Every
  // caller that must see the effect of its own action immediately — mount,
  // the manual refresh button, a folder create/delete — keeps forcing
  // `no-store`.
  const refreshFolderNames = useCallback(async (passive = false) => {
    const res = await fetch("/api/tree", passive ? {} : { cache: "no-store" });
    const data: VaultTree = await res.json();
    const list = data.folders ?? [];
    setFolders(list);

    // A folder that disappeared from the tree has its cached documents dropped
    // too — the rest stay put; nothing here re-fetches an open folder just
    // because the reader glanced back at the tab.
    const names = new Set(list.map((f) => f.name));
    for (const name of Object.keys(docsRef.current)) {
      if (!names.has(name)) delete docsRef.current[name];
    }
    docsRef.current = { ...docsRef.current };
    setDocs(docsRef.current);

    // An entry in a folder that hasn't been fetched is kept: not knowing its
    // documents is not evidence that the file is gone, same rule the heavy
    // refresh below uses.
    const stillExists = (e: { folder: string; id: string; kind: string }) => {
      if (!names.has(e.folder)) return false;
      const d = docsRef.current[e.folder];
      if (!d) return true;
      const inList = e.kind === "quiz" ? d.quizzes : d.lessons;
      return inList.some((l) => l.id === e.id);
    };
    setRecent(pruneRecent(stillExists));
    setFavorites(pruneFavorites(stillExists));
  }, []);

  // The expensive pass: folder names, every already-open folder's documents
  // re-fetched, and the tag map. Reserved for moments a stale doc list is
  // actually likely — first load, the refresh button, and a finished
  // generation run — never for a routine tab switch.
  const refreshTree = useCallback(async () => {
    await refreshFolderNames();
    const cached = Object.keys(docsRef.current);
    await Promise.all(cached.map(fetchDocs));
    refreshTags();
  }, [refreshFolderNames, fetchDocs, refreshTags]);

  // Ingest anything Claude Code wrote into vault/, and re-chunk documents whose
  // search index is stale. Off the tree's critical path on purpose (see
  // app/api/tree/route.ts): the sidebar draws first, and this re-reads it only
  // when it actually changed something.
  const sync = useCallback(async () => {
    try {
      const res = await fetch("/api/tree", { method: "POST" });
      if (!res.ok) return;
      const data = await res.json();
      if (data.imported > 0 || data.reindexed > 0) refreshTree();
    } catch {
      // A box with no vault/ has nothing to ingest — the common case, not an
      // error worth showing.
    }
  }, [refreshTree]);

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
  const onSelect = useCallback(
    (ref: LessonRef) => {
      setSelected(ref);
      setOverlay(null);
      // A search hit or a Recent row can name a folder that was never opened;
      // its documents are what give this one a title for the Recent list.
      openFolder(ref.folder);
      if (!window.matchMedia("(min-width: 1024px)").matches) setSidebarOpen(false);
    },
    [openFolder]
  );

  // Both overlays are opened from the sidebar, which on a narrow screen is
  // covering the column they render into.
  const openOverlay = useCallback(
    (
      next:
        | { kind: "profile" }
        | { kind: "discover" }
        | { kind: "people" }
        | { kind: "manage"; slug: string }
    ) => {
      setOverlay(next);
      if (!window.matchMedia("(min-width: 1024px)").matches) setSidebarOpen(false);
    },
    []
  );

  // Membership test the tree rows use, precomputed once per render.
  const favoriteKeys = new Set(favorites.map((f) => `${f.kind}:${f.folder}:${f.id}`));

  // The button is the deliberate full pass: re-read the tree *and* run the
  // ingest/reindex. Window focus only re-reads, since that fires constantly and
  // a lesson written by a terminal is what this button is for.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshTree();
      await sync();
    } finally {
      setRefreshing(false);
    }
  }, [refreshTree, sync]);

  // The tree first, then the housekeeping pass behind it. Ordered, not
  // parallel: an import that finds nothing new — the usual case — must not make
  // the reader wait for the folder list it was already entitled to.
  useEffect(() => {
    refreshTree().then(sync);
  }, [refreshTree, sync]);

  // A finished run wrote a file into vault/; the sync pass is what ingests it
  // into the database. The dialog used to trigger this, which meant closing it
  // lost the refresh — the job itself announces completion now, wherever the
  // reader happens to be.
  useEffect(() => {
    if (completedTick) sync();
  }, [completedTick, sync]);

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
  // outside this app, so the folder list can go stale while the window is in
  // the background. Re-check when the user returns to the window (or the tab
  // becomes visible) so a just-added folder shows up without a manual reload —
  // the cheap check only, not a re-fetch of every open folder's documents.
  //
  // `focus` and `visibilitychange` both fire on an ordinary tab switch, so
  // without a guard one alt-tab would check twice. `lastRun` coalesces that and
  // also caps how often an idle tab left in the background can trigger a
  // request at all — a reader alt-tabbing every few seconds should not cost a
  // request every few seconds.
  const lastAutoRefresh = useRef(0);
  useEffect(() => {
    const MIN_INTERVAL_MS = 15_000;
    const maybeRefresh = () => {
      const now = Date.now();
      if (now - lastAutoRefresh.current < MIN_INTERVAL_MS) return;
      lastAutoRefresh.current = now;
      refreshFolderNames(true);
    };
    const onFocus = () => maybeRefresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") maybeRefresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshFolderNames]);

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
              onKeyDown={(e) => {
                if (e.key === "Enter") setSubmittedQuery(query.trim());
              }}
              placeholder="Search notes... (press Enter)"
              className="w-full bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:text-gray-200 dark:placeholder:text-gray-500"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery("");
                  setSubmittedQuery("");
                }}
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

        {/* People who asked to follow the user — accepting is what lets them
            be offered a tag or invited to a folder. */}
        <FollowRequestsInbox onChanged={refreshTree} />

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
                  {/* Opens in the content column like the account editor and
                      the sharing console — leaving the workspace to browse
                      other people's folders would tear down the tree, the open
                      document and the running generation log, all to come back
                      to them a moment later. */}
                  <button
                    onClick={() => openOverlay({ kind: "discover" })}
                    title="Discover folders shared by other people"
                    className="ui-icon-btn h-6 w-6"
                  >
                    <SearchIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => openOverlay({ kind: "people" })}
                    title="Search people you follow"
                    className="ui-icon-btn h-6 w-6"
                  >
                    <UserIcon className="h-3.5 w-3.5" />
                  </button>
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
                <SearchResults query={submittedQuery} onSelect={onSelect} />
              ) : (
                <FileTree
                  folders={folders}
                  docs={docs}
                  selected={selected}
                  tagsByFolder={tagsByFolder}
                  favorites={favoriteKeys}
                  onSelect={onSelect}
                  onOpen={openFolder}
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
          <AccountPanel
            onClose={() => setOverlay(null)}
            onOpenPeople={() => openOverlay({ kind: "people" })}
          />
        ) : overlay?.kind === "discover" ? (
          <DiscoverPanel
            onClose={() => setOverlay(null)}
            // Joining a folder adds it to the reader's tree; the sidebar behind
            // this panel should already show it when they close it.
            onJoined={refreshTree}
          />
        ) : overlay?.kind === "people" ? (
          <PeoplePanel onClose={() => setOverlay(null)} />
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
