"use client";

import { motion } from "framer-motion";

export type ComparisonProperty = { name: string; values: string[] };
export type ComparisonTableData = {
  title?: string;
  items: string[];
  properties: ComparisonProperty[];
};

export default function ComparisonTable({ data }: { data: ComparisonTableData }) {
  const { title, items, properties } = data;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="not-prose my-6 overflow-hidden rounded-lg border border-line"
    >
      {title && (
        <p className="border-b border-line px-4 py-2 ui-section-title">
          {title}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="w-32 border-b border-r border-line px-4 py-2.5 text-left text-xs font-normal text-muted" />
              {items.map((item, i) => (
                <th
                  key={i}
                  className="border-b border-l border-line px-4 py-2.5 text-center text-sm font-semibold text-ink"
                >
                  {item}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {properties.map((prop, ri) => (
              <tr
                key={ri}
                className={
                  ri % 2 === 0
                    ? ""
                    : "bg-cover/40"
                }
              >
                <td className="border-r border-t border-line px-4 py-2.5 text-xs font-semibold text-ink">
                  {prop.name}
                </td>
                {prop.values.map((val, ci) => (
                  <td
                    key={ci}
                    className="border-l border-t border-line px-4 py-2.5 text-center text-ink-2"
                  >
                    {val}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
