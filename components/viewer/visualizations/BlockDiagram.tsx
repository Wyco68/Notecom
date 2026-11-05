"use client";

import { motion } from "framer-motion";

export type Block = string | { label: string; desc?: string };
export type BlockDiagramData = { title?: string; blocks: Block[]; columns?: number };

function blockLabel(b: Block): string {
  return typeof b === "string" ? b : b.label;
}
function blockDesc(b: Block): string | undefined {
  return typeof b === "string" ? undefined : b.desc;
}

export default function BlockDiagram({ data }: { data: BlockDiagramData }) {
  const { title, blocks } = data;
  const cols =
    data.columns ??
    (blocks.length <= 2 ? blocks.length : blocks.length <= 4 ? 2 : 3);

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
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {blocks.map((block, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, delay: i * 0.04 }}
            className="rounded-md border border-line bg-cover/60 p-3 text-center"
          >
            <div className="text-sm font-semibold text-ink">
              {blockLabel(block)}
            </div>
            {blockDesc(block) && (
              <div className="mt-1 text-xs text-muted">
                {blockDesc(block)}
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
