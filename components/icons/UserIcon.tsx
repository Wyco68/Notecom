// Generic person mark, used as the avatar placeholder when a profile has no
// uploaded photo. Same hand-rolled inline-SVG convention as the other icons.
export default function UserIcon({ className = "" }: { className?: string }) {
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
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.6 3.6-6 8-6s8 2.4 8 6" />
    </svg>
  );
}
