"use client";

import { useEffect, type ReactNode } from "react";
import CloseIcon from "../icons/CloseIcon";

// The one dialog shell: a dimmed page, a raised sheet, a title and the way out.
export default function Modal({
  title,
  onClose,
  children,
  size = "sm",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** sm for confirmations and one-field forms, md for the generation dialogs. */
  size?: "sm" | "md";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-[rgb(var(--shadow)/0.45)] p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`ui-rise max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-xl border border-line bg-raised p-5 shadow-panel sm:p-6 ${
          size === "md" ? "max-w-md" : "max-w-sm"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold tracking-tight text-ink">{title}</h2>
          <button onClick={onClose} title="Close" aria-label="Close" className="ui-icon-btn -mr-1.5 h-7 w-7">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
