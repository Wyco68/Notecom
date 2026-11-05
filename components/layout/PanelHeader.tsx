"use client";

import CloseIcon from "@/components/icons/CloseIcon";

// The heading and the way out, for every panel that renders in the workspace's
// content column: account, discovery, people, notifications, the sharing
// console.
//
// It exists because the same header was spelled five times with five small
// differences — three different back labels, two different vertical margins,
// one of them with its own local `BackControl` — and each copy drifted a
// little further from the others every time one of them was touched.
//
// The button-versus-link rule it enforces is the one the rest of the shell
// follows: with `onClose` the panel is a pane the shell can close, so the
// control is a `<button>`; without it the panel is a page, so the control is
// an `<a>` that actually navigates. A link that doesn't navigate and a button
// that does are both lies about what will happen.
export default function PanelHeader({
  title,
  subtitle,
  badge,
  actions,
  onClose,
  /** Where the link form goes. The vault, unless a panel has a nearer parent. */
  backHref = "/vault",
  className = "mb-8",
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** A count or status chip, sitting on the heading's baseline. */
  badge?: React.ReactNode;
  /** Panel-specific controls, left of the back control. */
  actions?: React.ReactNode;
  onClose?: () => void;
  backHref?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2.5">
          <h1 className="truncate text-2xl font-bold tracking-tight text-ink">
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && (
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {actions}
        {onClose ? (
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="ui-icon-btn h-8 w-8"
          >
            <CloseIcon className="h-[18px] w-[18px]" />
          </button>
        ) : (
          <a
            href={backHref}
            className="ui-btn ui-btn-sm ui-btn-text"
          >
            Back to notes
          </a>
        )}
      </div>
    </div>
  );
}
