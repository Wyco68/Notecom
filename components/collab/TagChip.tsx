"use client";

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
    ? "border-blue-500/50 bg-blue-500/10 text-blue-600 dark:text-blue-300"
    : "border-black/10 bg-black/5 text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300";

  return (
    <span
      onClick={onClick}
      className={`group inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors duration-150 ease-out ${tone} ${
        onClick ? "cursor-pointer hover:border-blue-600/50" : ""
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
          className="ui-focus rounded-full leading-none text-gray-400 hover:text-red-500 dark:hover:text-red-400"
          aria-label={`Remove ${label}`}
        >
          ×
        </button>
      )}
    </span>
  );
}
