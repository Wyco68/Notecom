import BrandMark from "@/components/icons/BrandMark";

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
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  /** The way out — back to the vault, or across to the other auth page. */
  footer?: React.ReactNode;
}) {
  return (
    <main id="main" tabIndex={-1} className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* The cover: the sidebar's gradient field, the mark, one line on what
          the app does. Wide screens only; a phone goes straight to the form. */}
      <div className="hidden flex-col justify-between border-r border-cover-line bg-chrome p-10 lg:flex">
        <Brand />
        <p className="max-w-xs text-[1.75rem] font-bold leading-tight tracking-tight text-ink">
          Lecture slides in.
          <br />
          Plain-language notes out.
        </p>
      </div>

      <div className="flex flex-col justify-center px-6 py-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Brand />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-8 flex flex-col gap-3 text-sm">{footer}</div>}
        </div>
      </div>
    </main>
  );
}

function Brand() {
  return (
    <span className="flex items-center gap-2.5 text-base font-bold tracking-tight text-ink">
      <BrandMark className="h-6 w-5" />
      Notecom
    </span>
  );
}

/** The muted link under the card. */
export function AuthFootLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="ui-focus self-start rounded text-muted transition-colors duration-150 ease-out hover:text-ink"
    >
      {children}
    </a>
  );
}
