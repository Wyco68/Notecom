// Loading placeholders.
//
// One rule behind all of them: a skeleton mirrors the layout that is coming, at
// the same sizes and in the same order, so the content landing doesn't move
// anything. A centred spinner tells the reader "wait" and nothing else; these
// tell them what they are waiting for.
//
// They pulse rather than shimmer — a travelling highlight is a second animation
// competing with the page's own enter transitions, and the reduced-motion block
// in globals.css already neutralises `animate-pulse` for anyone who asked.

/** A single grey line. `w` is any Tailwind width class. */
export function SkeletonLine({ w = "w-full", className = "" }: { w?: string; className?: string }) {
  return (
    <div
      className={`h-3.5 rounded bg-black/[0.06] dark:bg-white/[0.07] ${w} ${className}`}
      aria-hidden
    />
  );
}

/** A round placeholder, for an avatar. `size` is a Tailwind h/w pair. */
export function SkeletonCircle({ size = "h-20 w-20" }: { size?: string }) {
  return (
    <div
      className={`shrink-0 rounded-full bg-black/[0.06] dark:bg-white/[0.07] ${size}`}
      aria-hidden
    />
  );
}

/**
 * One card's worth of placeholder: a short heading rule and `lines` body lines,
 * the last one short so the block reads as a paragraph rather than a table.
 */
export function SkeletonCard({ lines = 3, children }: { lines?: number; children?: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-black/10 bg-black/[0.01] p-5 dark:border-white/10 dark:bg-white/[0.02]">
      <div className="mb-4 h-2.5 w-24 rounded bg-black/[0.08] dark:bg-white/[0.09]" aria-hidden />
      {children}
      <div className="space-y-2.5">
        {Array.from({ length: lines }, (_, i) => (
          <SkeletonLine key={i} w={i === lines - 1 ? "w-1/2" : i % 2 ? "w-11/12" : "w-full"} />
        ))}
      </div>
    </div>
  );
}

/**
 * Placeholder rows for a sidebar list. Widths vary per row so the block reads
 * as a list of names rather than a bar chart; the pattern is deterministic
 * because a random one would reshuffle on every re-render.
 */
export function SkeletonRows({ rows = 5, lines = 1 }: { rows?: number; lines?: number }) {
  const widths = ["w-4/5", "w-11/12", "w-2/3", "w-3/4", "w-5/6"];
  return (
    <div className="animate-pulse space-y-3 px-2 py-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <SkeletonLine w={widths[i % widths.length]} />
          {lines > 1 && <SkeletonLine w="w-1/2" className="h-2.5 opacity-60" />}
        </div>
      ))}
    </div>
  );
}

/**
 * The frame every settings-style panel loads behind: a title rule, then a stack
 * of cards. `cards` should match the number the real panel renders, and the
 * first one can carry an avatar row.
 */
export function SkeletonPanel({
  cards = 3,
  avatar = false,
  maxWidth = "max-w-2xl",
}: {
  cards?: number;
  avatar?: boolean;
  maxWidth?: string;
}) {
  return (
    <div
      className={`mx-auto animate-pulse p-4 sm:p-8 ${maxWidth}`}
      role="status"
      aria-label="Loading"
    >
      <div className="mb-8 flex items-baseline justify-between gap-3">
        <div className="h-5 w-28 rounded bg-black/[0.08] dark:bg-white/[0.09]" aria-hidden />
        <div className="h-4 w-20 rounded bg-black/[0.05] dark:bg-white/[0.06]" aria-hidden />
      </div>
      {Array.from({ length: cards }, (_, i) => (
        <SkeletonCard key={i} lines={i === 0 ? 2 : 3}>
          {i === 0 && avatar && (
            <div className="mb-6 flex items-center gap-4">
              <SkeletonCircle />
              <div className="min-w-0 flex-1 space-y-2.5">
                <SkeletonLine w="w-24" />
                <SkeletonLine w="w-40" />
              </div>
            </div>
          )}
        </SkeletonCard>
      ))}
    </div>
  );
}
