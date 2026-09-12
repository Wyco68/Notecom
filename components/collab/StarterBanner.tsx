"use client";

import { useEffect, useState } from "react";
import { useToast } from "../toast/ToastProvider";
import type { StarterTag } from "@/lib/collab/types";

// What a brand-new account sees instead of an empty vault.
//
// Notes need an account, and an account starts with nothing in it: no folders
// of its own until it generates some, and no shared ones until somebody
// follows it back and hands it a tag. So the first screen used to be "Select a
// lesson from the sidebar" with no lesson to select — a dead end that reads as
// a broken app rather than as a new one.
//
// One row, one action: claim the published starter tag, which is what makes the
// demo courses readable, and follow the account that published it in the same
// call. It is not a modal and it is not the empty state itself — the reader can
// dismiss it and keep the workspace they were shown.
//
// It removes itself for good once the tag is held or the reader owns a folder
// of their own, so it cannot come back to greet someone on their hundredth
// visit. Dismissal is per-browser (localStorage) because it is a preference
// about this screen, not a fact about the account.

const DISMISSED_KEY = "notecom.starter.dismissed";

/** Reading localStorage throws in some privacy modes; a throw means "not dismissed". */
function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export default function StarterBanner({ onClaimed }: { onClaimed?: () => void }) {
  const [tag, setTag] = useState<StarterTag | null>(null);
  // Starts true so nothing flashes on screen before the check answers — the
  // banner appears once, deliberately, rather than blinking on every load.
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (readDismissed()) return;
    let cancelled = false;
    fetch("/api/collab/me/starter")
      .then((r) => (r.ok ? r.json() : { tag: null }))
      .then(({ tag }: { tag: StarterTag | null }) => {
        if (cancelled || !tag || tag.held || tag.ownsFolders) return;
        setTag(tag);
        setHidden(false);
      })
      // A signed-out reader, or a build with no collaboration, simply has no
      // starter offer. Not an error worth a toast.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function dismiss() {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // A browser that refuses storage gets the banner again next visit.
    }
  }

  async function claim() {
    setBusy(true);
    try {
      const res = await fetch("/api/collab/me/starter", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "could not add the demo courses");
      toast.success(
        data.owner
          ? `Demo courses added, and a follow request sent to ${data.owner}.`
          : "Demo courses added."
      );
      setHidden(true);
      onClaimed?.();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (hidden || !tag) return null;

  return (
    <div
      className="ui-rise flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-blue-600/20 bg-blue-600/[0.06] px-4 py-3 dark:border-blue-400/20 dark:bg-blue-400/[0.07]"
      role="region"
      aria-label="Starter courses"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          Your vault is empty — start with the demo courses
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
          {tag.owner ? (
            <>
              Adds the <span className="font-medium">{tag.label}</span> tag from{" "}
              <span className="font-medium">{tag.owner}</span>, which opens the course
              folders carrying it, and sends them a follow request so they can share more
              with you later.
            </>
          ) : (
            <>
              Adds the <span className="font-medium">{tag.label}</span> tag, which opens a
              few shared course folders to read.
            </>
          )}{" "}
          You can remove the tag any time in Account → My tags, which closes those folders
          again.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button onClick={claim} disabled={busy} className="ui-btn ui-btn-sm ui-btn-primary">
          {busy ? "Adding..." : "Add demo courses"}
        </button>
        <button
          onClick={dismiss}
          title="Dismiss"
          aria-label="Dismiss"
          className="ui-icon-btn h-7 w-7 text-xs"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
