"use client";

import { motion } from "framer-motion";

export type Layer = string | { name: string; detail?: string };
export type LayerStackData = { title?: string; layers: Layer[] };

function layerName(l: Layer): string {
  return typeof l === "string" ? l : l.name;
}
function layerDetail(l: Layer): string | undefined {
  return typeof l === "string" ? undefined : l.detail;
}

const LAYER_COLOR =
  "border-line bg-cover/60 text-ink";

export default function LayerStack({ data }: { data: LayerStackData }) {
  const { title, layers } = data;

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
      <div className="flex flex-col gap-1.5">
        {layers.map((layer, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, delay: i * 0.05 }}
            className={`flex items-center justify-between rounded-md border px-4 py-2.5 transition-colors ${LAYER_COLOR}`}
          >
            <span className="text-sm font-semibold">{layerName(layer)}</span>
            {layerDetail(layer) && (
              <span className="ml-4 text-xs opacity-60">{layerDetail(layer)}</span>
            )}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
