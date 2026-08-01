"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

// Dark theme: background matches computed dark:bg-blue-950/20 over the app's
// #0d1117 base (~#0f1523). Light text on dark blue — same palette as before.
const DARK_VARS = {
  background: "#0f1523",
  mainBkg: "#1e3a8a",
  nodeBorder: "#3b82f6",
  clusterBkg: "#0f172a",
  clusterBorder: "#1e40af",
  primaryColor: "#1e3a8a",
  primaryBorderColor: "#3b82f6",
  primaryTextColor: "#dbeafe",
  secondaryColor: "#1d4ed8",
  secondaryBorderColor: "#60a5fa",
  secondaryTextColor: "#dbeafe",
  tertiaryColor: "#0f172a",
  tertiaryBorderColor: "#1e40af",
  tertiaryTextColor: "#dbeafe",
  lineColor: "#60a5fa",
  textColor: "#dbeafe",
  titleColor: "#dbeafe",
  edgeLabelBackground: "#0f1523",
  noteBkgColor: "#1e3a8a",
  noteTextColor: "#dbeafe",
  noteBorderColor: "#3b82f6",
  fontSize: "19px",
};

// Light theme: background matches bg-blue-50 (#eff6ff). Dark text on light blue.
const LIGHT_VARS = {
  background: "#eff6ff",
  mainBkg: "#bfdbfe",
  nodeBorder: "#2563eb",
  clusterBkg: "#dbeafe",
  clusterBorder: "#93c5fd",
  primaryColor: "#bfdbfe",
  primaryBorderColor: "#2563eb",
  primaryTextColor: "#1e3a8a",
  secondaryColor: "#dbeafe",
  secondaryBorderColor: "#3b82f6",
  secondaryTextColor: "#1e40af",
  tertiaryColor: "#eff6ff",
  tertiaryBorderColor: "#93c5fd",
  tertiaryTextColor: "#1e3a8a",
  lineColor: "#2563eb",
  textColor: "#1e3a8a",
  titleColor: "#1e3a8a",
  edgeLabelBackground: "#eff6ff",
  noteBkgColor: "#dbeafe",
  noteTextColor: "#1e40af",
  noteBorderColor: "#93c5fd",
  fontSize: "19px",
};

// Re-initialize only when the mode flips, not on every render.
let lastInitMode: boolean | null = null;

async function getMermaid(isDark: boolean) {
  const mermaid = (await import("mermaid")).default;
  if (lastInitMode !== isDark) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      // "strict" (mermaid's own default) sanitizes labels and drops
      // click/script interactivity from the rendered SVG before it reaches
      // dangerouslySetInnerHTML below. Diagram source can come from another
      // member's shared folder, not just the viewer's own lessons, and the
      // documented contract (docs/html-output-contract.md) never asks for
      // click handlers or inline styling — "loose" was buying no feature,
      // only a stored-XSS surface.
      securityLevel: "strict",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      themeVariables: isDark ? DARK_VARS : LIGHT_VARS,
    });
    lastInitMode = isDark;
  }
  return mermaid;
}

function makeResponsive(svg: string): string {
  return svg
    .replace(/style="max-width:[^"]*"/, 'style="max-width:100%"')
    .replace(/<svg /, '<svg width="100%" ');
}

export default function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSvg("");
    setError(null);

    (async () => {
      try {
        const mermaid = await getMermaid(isDark);
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, code.trim());
        if (!cancelled) setSvg(makeResponsive(svg));
      } catch (err: unknown) {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "failed to render diagram"
          );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, isDark]);

  if (error) {
    return (
      <div className="my-5 rounded-md border border-red-300 bg-red-50 p-4 dark:border-red-800/60 dark:bg-red-950/30">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
          Diagram failed to render
        </p>
        <pre className="overflow-x-auto text-xs text-red-700 dark:text-red-200">
          {code.trim()}
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-6 flex h-48 items-center justify-center rounded-md border border-blue-300 bg-blue-50 text-sm text-blue-400 dark:border-blue-800/50 dark:bg-blue-950/20 dark:text-blue-600">
        Rendering diagram...
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="mermaid-diagram my-6 overflow-x-auto rounded-md border border-blue-300 bg-blue-50 p-8 dark:border-blue-800/50 dark:bg-blue-950/20"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
