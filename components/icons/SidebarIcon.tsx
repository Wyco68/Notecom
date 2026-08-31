// One glyph for both directions of the same control: the collapse button in
// the sidebar's own header and the expand button in the content top bar. The
// panel is drawn filled when it is open and hollow when it is not, so the icon
// states what is there rather than which way it will move.
export default function SidebarIcon({
  className = "h-4 w-4",
  open = true,
}: {
  className?: string;
  open?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <line x1="9.5" y1="4" x2="9.5" y2="20" />
      {open && <rect x="3.9" y="4.9" width="4.7" height="14.2" rx="1.6" fill="currentColor" stroke="none" />}
    </svg>
  );
}
