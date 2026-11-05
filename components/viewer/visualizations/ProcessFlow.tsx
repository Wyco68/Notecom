"use client";

import { motion } from "framer-motion";
import ChevronIcon from "../../icons/ChevronIcon";

export type Step = string | { label: string; desc?: string };
export type ProcessFlowData = {
  steps: Step[];
  direction?: "horizontal" | "vertical";
  title?: string;
};

function stepLabel(s: Step): string {
  return typeof s === "string" ? s : s.label;
}
function stepDesc(s: Step): string | undefined {
  return typeof s === "string" ? undefined : s.desc;
}

export default function ProcessFlow({ data }: { data: ProcessFlowData }) {
  const { steps, title } = data;
  const isVertical =
    data.direction === "vertical" || (!data.direction && steps.length > 4);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="not-prose my-6 rounded-md border border-line p-4"
    >
      {title && (
        <p className="mb-3 ui-section-title">
          {title}
        </p>
      )}
      <div
        className={`flex ${
          isVertical
            ? "flex-col items-center"
            : "flex-wrap items-center justify-center"
        } gap-2`}
      >
        {steps.map((step, i) => (
          <div
            key={i}
            className={`flex ${isVertical ? "flex-col items-center" : "items-center"} gap-2`}
          >
            <div className="group relative">
              <div className="rounded-md border border-line bg-cover/60 px-4 py-2 text-sm font-medium text-ink">
                {stepLabel(step)}
              </div>
              {stepDesc(step) && (
                <div className="absolute left-1/2 top-full z-10 mt-1 hidden w-max max-w-56 -translate-x-1/2 rounded border border-line bg-paper px-3 py-1.5 text-xs text-muted shadow-panel group-hover:block">
                  {stepDesc(step)}
                </div>
              )}
            </div>
            {i < steps.length - 1 && (
              <ChevronIcon className={`h-4 w-4 shrink-0 text-muted ${isVertical ? "rotate-90" : ""}`} />
            )}
          </div>
        ))}
      </div>
    </motion.div>
  );
}
