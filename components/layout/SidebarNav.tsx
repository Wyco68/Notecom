"use client";

import BellIcon from "@/components/icons/BellIcon";
import StarIcon from "@/components/icons/StarIcon";
import SearchIcon from "@/components/icons/SearchIcon";
import UserIcon from "@/components/icons/UserIcon";
import { useNotifications } from "@/components/collab/NotificationsProvider";

// The sidebar's destinations: the three places the reader goes, as opposed to
// the things they do.
//
// All three used to be icon-only buttons filed under the "Folders" heading,
// which put two navigation destinations inside a folder toolbar and left the
// third (notifications) up in the window chrome beside the theme toggle.
// Placement was claiming a relationship none of them had. They are one group
// now, labelled, because a destination the reader has to hover to identify is
// a destination they will not use.
//
// Actions stay icon-only elsewhere — new folder and generate on the Folders
// row, theme and refresh in the foot. Label what you navigate to; leave a
// glyph on what acts in place.

export default function SidebarNav({
  active,
  onOpen,
}: {
  active: "home" | "notifications" | "discover" | "people" | null;
  onOpen: (kind: "home" | "notifications" | "discover" | "people") => void;
}) {
  // Null when collaboration isn't configured on this build — the whole group
  // goes with it, since all three destinations are collaboration.
  const notifications = useNotifications();
  if (!notifications) return null;

  return (
    <nav aria-label="Workspace" className="border-b border-black/10 px-2 py-2 dark:border-white/10">
      <NavRow
        icon={<StarIcon className="h-4 w-4" />}
        label="Home"
        active={active === "home"}
        onClick={() => onOpen("home")}
      />
      <NavRow
        icon={<BellIcon className="h-4 w-4" />}
        label="Notifications"
        active={active === "notifications"}
        onClick={() => onOpen("notifications")}
        count={notifications.count}
      />
      <NavRow
        icon={<SearchIcon className="h-4 w-4" />}
        label="Discover"
        active={active === "discover"}
        onClick={() => onOpen("discover")}
      />
      <NavRow
        icon={<UserIcon className="h-4 w-4" />}
        label="People"
        active={active === "people"}
        onClick={() => onOpen("people")}
      />
    </nav>
  );
}

function NavRow({
  icon,
  label,
  active,
  onClick,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  /** Pending items. Renders nothing at zero rather than a "0" chip. */
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`ui-row flex w-full items-center gap-2.5 px-1.5 py-1.5 text-left text-sm ${
        active
          ? "bg-blue-600/10 text-blue-700 dark:bg-blue-600/20 dark:text-blue-300"
          : "text-gray-700 dark:text-gray-300"
      }`}
    >
      <span className={`shrink-0 ${active ? "" : "text-gray-500 dark:text-gray-400"}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {!!count && (
        <span
          data-numeric
          className="ui-badge shrink-0 border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
