// The app mark: a page on the blue gradient. Every copy defines the same
// gradient under the same id, so a duplicate id resolves to identical paint.
export default function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="brand-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3478f6" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="19" height="23" rx="4" fill="url(#brand-grad)" />
      <path d="M5.5 8h9M5.5 12h9M5.5 16h5.5" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
