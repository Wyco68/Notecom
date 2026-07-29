"use client";

import { useEffect, useState } from "react";

// A collapsible tag heading in the sidebar. Open state is remembered per tag
// so the shape of the tree survives a reload — a user who works out of one
// tag shouldn't re-open it on every visit.
const OPEN_KEY = "lecture.openTagGroups";

function readOpen(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export default function TagGroup({
  tag,
  count,
  defaultOpen = true,
  children,
}: {
  tag: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Read persisted state after mount, not during render: localStorage does not
  // exist on the server and reading it in useState would break hydration.
  useEffect(() => {
    const stored = readOpen()[tag];
    if (typeof stored === "boolean") setOpen(stored);
  }, [tag]);

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify({ ...readOpen(), [tag]: next }));
    } catch {
      // Storage denied: the group still toggles, it just won't be remembered.
    }
  }

  return (
    <div className="mb-1">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="ui-row flex w-full items-center gap-1.5 px-2 py-1 text-left"
      >
        <span className="text-[10px] text-gray-400">{open ? "▾" : "▸"}</span>
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
          {tag}
        </span>
        <span className="ml-auto shrink-0 tabular-nums text-[10px] text-gray-400">{count}</span>
      </button>
      {open && <div className="ml-1.5 border-l border-black/10 pl-1 dark:border-white/10">{children}</div>}
    </div>
  );
}
