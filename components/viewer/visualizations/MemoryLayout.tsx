"use client";

import { motion } from "framer-motion";

export type MemorySegment = { name: string; size?: string; note?: string };
export type MemoryLayoutData = { title?: string; segments: MemorySegment[] };

export default function MemoryLayout({ data }: { data: MemoryLayoutData }) {
  const { title, segments } = data;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="not-prose my-6 flex justify-center"
    >
      <div className="w-64 overflow-hidden rounded-md border border-line">
        {title && (
          <p className="border-b border-line py-2 text-center ui-section-title">
            {title}
          </p>
        )}
        <p className="px-3 pt-1 text-right text-[10px] text-muted">
          High Address ▲
        </p>
        <div className="flex flex-col gap-0.5 px-1 pb-1">
          {segments.map((seg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center justify-between rounded border border-line bg-cover/60 px-3 py-1.5"
            >
              <span className="text-sm font-semibold text-ink">
                {seg.name}
              </span>
              {(seg.size ?? seg.note) && (
                <span className="ml-3 text-xs text-muted">
                  {[seg.size, seg.note].filter(Boolean).join(" · ")}
                </span>
              )}
            </motion.div>
          ))}
        </div>
        <p className="px-3 pb-1 text-right text-[10px] text-muted">
          ▼ Low Address
        </p>
      </div>
    </motion.div>
  );
}
