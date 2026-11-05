"use client";

import CloseIcon from "@/components/icons/CloseIcon";

// A topic on a folder. Topics are labels, not access (0026), so every chip
// looks the same; only `active` (a selected filter) changes its tone.
export default function TagChip({
  label,
  active = false,
  onClick,
  onRemove,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}) {
  const tone = active
    ? "border-accent/40 bg-accent/10 text-accent"
    : "border-line text-ink-2";

  return (
    <span
      onClick={onClick}
      className={`group inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs transition-colors duration-150 ease-out ${tone} ${
        onClick ? "cursor-pointer hover:border-accent/40" : ""
      }`}
    >
      {label}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          // Always visible, not hover-revealed: a touch screen has no hover,
          // so a hidden × made a topic impossible to remove there.
          className="ui-focus rounded leading-none text-muted hover:text-ink"
          aria-label={`Remove ${label}`}
        >
          <CloseIcon className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
