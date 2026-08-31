// The frame the three auth pages share: sign-in, sign-up, password reset.
//
// They were three bare centred columns with no mark on them, which made the
// only pages a signed-out visitor ever sees the only pages that didn't look
// like the app. One card, one mark, one footer slot.
//
// `min-h-dvh`, not `min-h-screen`: on iOS Safari `100vh` is the height the
// viewport has with the toolbars *hidden*, so a centred column jumps as they
// slide away mid-scroll.
export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: React.ReactNode;
  children: React.ReactNode;
  /** The way out — back to the vault, or across to the other auth page. */
  footer?: React.ReactNode;
}) {
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <div className="mb-6 flex items-center gap-2.5">
        <Mark />
        <span className="text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-200">
          Notecom
        </span>
      </div>

      <div className="ui-card bg-white p-6 shadow-panel dark:bg-[#161b22] dark:shadow-panel-dark">
        <h1 className="mb-1.5 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          {title}
        </h1>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        {children}
      </div>

      {footer && <div className="mt-6 flex flex-col gap-3 text-center text-sm">{footer}</div>}
    </main>
  );
}

// The app mark from app/icon.svg, at badge size and inline rather than as an
// <img>: it is eight shapes, and a request for them on the one page that has
// nothing else to load is a request too many.
function Mark() {
  return (
    <svg viewBox="0 0 512 512" className="h-7 w-7 shrink-0 rounded-md" aria-hidden>
      <rect width="512" height="512" rx="112" fill="#2563eb" />
      <path
        d="M148 88 H292 L372 168 V352 a28 28 0 0 1 -28 28 H148 a28 28 0 0 1 -28 -28 V116 a28 28 0 0 1 28 -28 Z"
        fill="#ffffff"
      />
      <path d="M292 88 L372 168 H292 Z" fill="#93c5fd" />
      <g fill="#2563eb">
        <rect x="160" y="212" width="172" height="24" rx="12" />
        <rect x="160" y="268" width="112" height="24" rx="12" />
        <rect x="160" y="324" width="80" height="24" rx="12" />
      </g>
      <g stroke="#ffffff" strokeWidth="24" fill="none" strokeLinecap="round">
        <line x1="392" y1="392" x2="436" y2="436" />
        <circle cx="352" cy="352" r="64" fill="#1d4ed8" />
      </g>
    </svg>
  );
}

/** The muted link under the card. */
export function AuthFootLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="ui-focus rounded text-gray-500 transition-colors duration-150 ease-out hover:text-gray-700 dark:hover:text-gray-300"
    >
      {children}
    </a>
  );
}
