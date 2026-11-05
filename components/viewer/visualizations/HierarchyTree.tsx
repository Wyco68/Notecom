"use client";

import { motion } from "framer-motion";

export type TreeNode = { label: string; children?: TreeNode[] };
export type HierarchyTreeData = { title?: string; root: TreeNode };

function TreeBranch({ node, depth }: { node: TreeNode; depth: number }) {
  const hasChildren = (node.children?.length ?? 0) > 0;

  return (
    <div style={depth > 0 ? { paddingLeft: "1.25rem" } : undefined}>
      <div className="flex items-center gap-2 py-0.5">
        <div
          className={`h-2 w-2 flex-shrink-0 rounded-full border-2 ${
            hasChildren
              ? "border-accent bg-accent"
              : "border-muted/60 bg-paper"
          }`}
        />
        <span
          className={`text-sm ${
            hasChildren
              ? "font-semibold text-ink"
              : "text-ink-2"
          }`}
        >
          {node.label}
        </span>
      </div>
      {hasChildren && (
        <div className="ml-1 border-l border-line pl-1">
          {(node.children ?? []).map((child, i) => (
            <TreeBranch key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function HierarchyTree({ data }: { data: HierarchyTreeData }) {
  const { title, root } = data;

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
      <TreeBranch node={root} depth={0} />
    </motion.div>
  );
}
