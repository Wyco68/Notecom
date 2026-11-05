"use client";

import { useEffect, useState } from "react";
import ChevronIcon from "../icons/ChevronIcon";

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
        className="ui-row flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        <ChevronIcon
          className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-150 ease-out ${open ? "rotate-90" : ""}`}
        />
        <span className="truncate ui-section-title">
          {tag}
        </span>
        <span data-numeric className="ml-auto shrink-0 text-[11px] text-muted">{count}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}
