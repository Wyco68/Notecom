"use client";

import SidebarIcon from "@/components/icons/SidebarIcon";

// The content column's own header strip.
//
// It replaces a round button that floated *over* the document at top-left and
// the permanent `pt-12` every page carried to dodge it — a control sitting on
// top of the thing it was meant to leave alone, and a reserved gap that
// existed whether or not the control was showing.
//
// It also answers a question the sidebar used to own alone: which note is
// open. The tree can be closed, scrolled away or on a phone; the bar cannot.
//
// Deliberately blank on the right when a panel has taken the column: the
// panels render their own `PanelHeader` h1, and naming them here too would put
// every panel's title on screen twice.
export default function ContentTopBar({
  sidebarOpen,
  onToggleSidebar,
  folder,
  title,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** Folder display name of the open document, when one is open. */
  folder?: string | null;
  title?: string | null;
}) {
  return (
    // No z-index: a sticky element already paints above in-flow content, and
    // `z-backdrop` put it on the mobile drawer's own layer — the bar stayed
    // bright, undimmed and clickable across the top of an open drawer, and
    // clicking it didn't dismiss the drawer the way the rest of the overlay
    // does. `shrink-0` was inert too; <main> is a block, not a flex container.
    <div className="sticky top-0 flex h-12 items-center gap-2 border-b border-black/10 bg-white/85 px-2 backdrop-blur-sm dark:border-white/10 dark:bg-[#0d1117]/85">
      {/* Only while the sidebar is hidden. Open, the sidebar carries its own
          collapse control in its header — showing both put two buttons for one
          job three centimetres apart, on either side of the divider, which
          reads as an accident rather than a choice. */}
      {!sidebarOpen && (
        <button
          onClick={onToggleSidebar}
          title="Show sidebar"
          aria-label="Show sidebar"
          aria-controls="sidebar"
          aria-expanded={false}
          className="ui-icon-btn h-8 w-8"
        >
          <SidebarIcon className="h-4 w-4" open={false} />
        </button>
      )}

      {title && (
        <p className={`flex min-w-0 items-center gap-1.5 text-sm ${sidebarOpen ? "pl-1.5" : ""}`}>
          {folder && (
            <>
              <span className="hidden shrink-0 truncate text-gray-500 sm:inline dark:text-gray-400">
                {folder}
              </span>
              <span className="hidden shrink-0 text-gray-300 sm:inline dark:text-gray-600">›</span>
            </>
          )}
          <span className="min-w-0 truncate font-medium text-gray-800 dark:text-gray-200">
            {title}
          </span>
        </p>
      )}
    </div>
  );
}
