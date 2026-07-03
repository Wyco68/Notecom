"use client";

import { useCallback, useEffect, useState } from "react";
import type { Folder, LessonRef, VaultTree } from "@/lib/vault/types";
import FileTree from "../sidebar/FileTree";
import LessonViewer from "../viewer/LessonViewer";
import NewFolderModal from "../modals/NewFolderModal";
import ThemeToggle from "../theme/ThemeToggle";
import RefreshIcon from "../icons/RefreshIcon";

export default function AppShell() {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [selected, setSelected] = useState<LessonRef | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
            Notes
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh — pick up newly added lessons and quizzes"
              className="flex h-7 w-7 items-center justify-center rounded text-gray-500 hover:bg-black/5 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/10"
            >
              <RefreshIcon className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <ThemeToggle />
          </div>
        </div>

        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
            Subjects
          </span>
          <button
            onClick={() => setShowNewFolder(true)}
            title="New Folder"
            className="flex h-5 w-5 items-center justify-center rounded text-gray-600 hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10"
          >
            +
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          <FileTree
            folders={folders}
            selected={selected}
            onSelect={setSelected}
            onChanged={refreshTree}
          />
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-white dark:bg-[#0d1117]">
        <LessonViewer lesson={selected} />
      </main>

      {showNewFolder && (
        <NewFolderModal
          onClose={() => setShowNewFolder(false)}
          onCreated={refreshTree}
        />
      )}
    </div>
  );
}
