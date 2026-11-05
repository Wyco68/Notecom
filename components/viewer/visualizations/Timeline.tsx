"use client";

import { motion } from "framer-motion";

export type TimelineItem = { label: string; desc?: string };
export type TimelineData = { title?: string; items: TimelineItem[] };

export default function Timeline({ data }: { data: TimelineData }) {
  const { title, items } = data;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="not-prose my-6 rounded-md border border-line p-5"
    >
      {title && (
        <p className="mb-4 ui-section-title">
          {title}
        </p>
      )}
      <div className="flex flex-col">
        {items.map((item, i) => (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="mt-1 h-3 w-3 flex-shrink-0 rounded-full border-2 border-accent bg-paper" />
              {i < items.length - 1 && (
                <div className="mt-1 min-h-[1.5rem] w-px flex-1 bg-line" />
              )}
            </div>
            <div className="pb-4">
              <div className="text-sm font-semibold text-ink">
                {item.label}
              </div>
              {item.desc && (
                <div className="mt-0.5 text-sm leading-relaxed text-muted">
                  {item.desc}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
