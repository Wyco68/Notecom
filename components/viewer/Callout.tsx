import type { ReactNode } from "react";

// A callout is a faint wash in its kind's colour with a small label above
// the text. No side stripe.
const VARIANTS = {
  "Key Idea": { label: "text-accent", bg: "bg-accent/[0.06]" },
  "Common Mistake": { label: "text-warn", bg: "bg-warn/[0.07]" },
  "Exam Tip": { label: "text-accent", bg: "bg-accent/[0.06]" },
  Remember: { label: "text-ok", bg: "bg-ok/[0.07]" },
  Reasoning: { label: "text-ink-2", bg: "bg-ink/[0.04]" },
  Answer: { label: "text-ok", bg: "bg-ok/[0.07]" },
} as const;

type CalloutKind = keyof typeof VARIANTS;

export function detectCalloutKind(text: string): CalloutKind | null {
  for (const kind of Object.keys(VARIANTS) as CalloutKind[]) {
    if (text.trim().startsWith(`${kind}:`)) return kind;
  }
  return null;
}

export default function Callout({
  kind,
  children,
}: {
  kind: CalloutKind;
  children: ReactNode;
}) {
  const v = VARIANTS[kind];
  return (
    <div className={`!my-6 rounded-xl px-4 py-3.5 ${v.bg}`}>
      <div className={`mb-1 text-[11px] font-bold uppercase tracking-[0.06em] ${v.label}`}>{kind}</div>
      <div className="text-[0.95em] leading-relaxed text-ink">{children}</div>
    </div>
  );
}
