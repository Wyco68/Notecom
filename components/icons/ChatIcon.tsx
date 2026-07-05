export default function ChatIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 12a8 8 0 0 1-8 8H5.6L3 22V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />
      <line x1="8" y1="11" x2="16" y2="11" />
      <line x1="8" y1="14" x2="13" y2="14" />
    </svg>
  );
}
