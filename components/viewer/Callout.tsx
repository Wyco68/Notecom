import type { ReactNode } from "react";

const VARIANTS = {
  "Key Idea": {
    border: "border-blue-300 dark:border-blue-800/60",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    label: "text-blue-700 dark:text-blue-300",
  },
  "Common Mistake": {
    border: "border-red-300 dark:border-red-800/60",
    bg: "bg-red-50 dark:bg-red-950/30",
    label: "text-red-700 dark:text-red-300",
  },
  "Exam Tip": {
    border: "border-yellow-300 dark:border-yellow-700/60",
    bg: "bg-yellow-50 dark:bg-yellow-950/30",
    label: "text-yellow-700 dark:text-yellow-300",
  },
  Remember: {
    border: "border-emerald-300 dark:border-emerald-800/60",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    label: "text-emerald-700 dark:text-emerald-300",
  },
  Reasoning: {
    border: "border-purple-300 dark:border-purple-800/60",
    bg: "bg-purple-50 dark:bg-purple-950/30",
    label: "text-purple-700 dark:text-purple-300",
  },
  Answer: {
    border: "border-teal-300 dark:border-teal-800/60",
    bg: "bg-teal-50 dark:bg-teal-950/30",
    label: "text-teal-700 dark:text-teal-300",
  },
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
    <div className={`not-prose my-4 rounded-md border ${v.border} ${v.bg} px-4 py-3`}>
      <div className={`mb-1 text-xs font-semibold uppercase tracking-wide ${v.label}`}>{kind}</div>
      <div className="text-sm leading-relaxed text-gray-800 dark:text-gray-200">{children}</div>
    </div>
  );
}
