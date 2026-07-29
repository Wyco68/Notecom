"use client";

// A tag that grants join gets the emerald treatment — it is the one visual
// difference that carries a permission meaning, so it is worth distinguishing.
export default function TagChip({
  label,
  grantsJoin = false,
  active = false,
  onClick,
  onRemove,
}: {
  label: string;
  grantsJoin?: boolean;
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}) {
  const tone = grantsJoin
    ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-300"
    : active
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
          className="ui-reveal ui-focus rounded-full leading-none text-gray-400 hover:text-red-500 dark:hover:text-red-400"
          aria-label={`Remove ${label}`}
        >
          ×
        </button>
      )}
    </span>
  );
}
