"use client";

import { useCallback, useEffect, useState } from "react";
import type { Folder, LessonRef, VaultTree } from "@/lib/vault/types";
import FileTree from "../sidebar/FileTree";
import SearchResults from "../sidebar/SearchResults";
import LessonViewer from "../viewer/LessonViewer";
import NewFolderModal from "../modals/NewFolderModal";
import GenerateModal from "../modals/GenerateModal";
import ChatPanel from "../chat/ChatPanel";
import ThemeToggle from "../theme/ThemeToggle";
import RefreshIcon from "../icons/RefreshIcon";
import SearchIcon from "../icons/SearchIcon";
import ChatIcon from "../icons/ChatIcon";
import UploadIcon from "../icons/UploadIcon";

export default function AppShell() {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [selected, setSelected] = useState<LessonRef | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");

  const currentTitle = (() => {
    if (!selected || !folders) return null;
    const f = folders.find((f) => f.name === selected.folder);
    const list =
      selected.kind === "quiz"
        ? f?.quizzes
        : selected.kind === "assignment"
        ? f?.assignments
        : f?.lessons;
    return list?.find((l) => l.id === selected.id)?.title ?? null;
  })();

  const refreshTree = useCallback(async () => {
    const res = await fetch("/api/tree", { cache: "no-store" });
    const data: VaultTree = await res.json();
    setFolders(data.folders ?? []);
  }, []);

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
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-72 flex-col border-r border-black/10 bg-gray-50 dark:border-white/10 dark:bg-[#0a0e14]">
        <div className="flex items-center justify-between border-b border-black/10 px-3 py-3 dark:border-white/10">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-200">
            LectureLens
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowGenerate(true)}
              title="Generate a lesson or quiz from a file (runs local Claude Code)"
              className="flex h-7 w-7 items-center justify-center rounded text-gray-500 hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/10"
            >
              <UploadIcon className="h-4 w-4" />
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh — pick up newly added lessons, quizzes, and assignments"
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

        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
            {query.trim() ? "Results" : "Subjects"}
          </span>
          {!query.trim() && (
            <button
              onClick={() => setShowNewFolder(true)}
              title="New Folder"
              className="flex h-5 w-5 items-center justify-center rounded text-gray-600 hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10"
            >
              +
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {query.trim() ? (
            <SearchResults query={query.trim()} onSelect={setSelected} />
          ) : (
            <FileTree
              folders={folders}
              selected={selected}
              onSelect={setSelected}
              onChanged={refreshTree}
            />
          )}
        </div>
      </aside>

      <main className="relative flex-1 overflow-y-auto bg-white dark:bg-[#0d1117]">
        <LessonViewer lesson={selected} />
      </main>

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
        />
      )}
    </div>
  );
}
