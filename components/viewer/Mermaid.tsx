"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

// Diagrams use the app palette (app/globals.css): white nodes ruled in blue,
// pale-blue groups, muted ink for the lines; graphite in dark. Mermaid needs
// literal colours, so these mirror the tokens.
const DARK_VARS = {
  background: "#0e0e10",
  mainBkg: "#18181b",
  nodeBorder: "#6ea5ff",
  clusterBkg: "#141416",
  clusterBorder: "#2c2c31",
  primaryColor: "#18181b",
  primaryBorderColor: "#6ea5ff",
  primaryTextColor: "#ededf0",
  secondaryColor: "#1f1f23",
  secondaryBorderColor: "#6ea5ff",
  secondaryTextColor: "#ededf0",
  tertiaryColor: "#141416",
  tertiaryBorderColor: "#2c2c31",
  tertiaryTextColor: "#ededf0",
  lineColor: "#9a9aa3",
  textColor: "#ededf0",
  titleColor: "#ededf0",
  edgeLabelBackground: "#0e0e10",
  noteBkgColor: "#26221a",
  noteTextColor: "#ededf0",
  noteBorderColor: "#ecb25a",
  fontSize: "17px",
};

const LIGHT_VARS = {
  background: "#ffffff",
  mainBkg: "#ffffff",
  nodeBorder: "#2563eb",
  clusterBkg: "#f1f5fd",
  clusterBorder: "#d6e0f2",
  primaryColor: "#ffffff",
  primaryBorderColor: "#2563eb",
  primaryTextColor: "#111827",
  secondaryColor: "#f1f5fd",
  secondaryBorderColor: "#2563eb",
  secondaryTextColor: "#111827",
  tertiaryColor: "#ffffff",
  tertiaryBorderColor: "#d6e0f2",
  tertiaryTextColor: "#111827",
  lineColor: "#646c7d",
  textColor: "#111827",
  titleColor: "#111827",
  edgeLabelBackground: "#ffffff",
  noteBkgColor: "#fdf6e7",
  noteTextColor: "#111827",
  noteBorderColor: "#965808",
  fontSize: "17px",
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
      fontFamily: "var(--font-sans), ui-sans-serif, system-ui, sans-serif",
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
      <div className="my-5 rounded-md border border-danger/40 bg-danger/[0.06] p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-danger">
          Diagram failed to render
        </p>
        <pre className="overflow-x-auto text-xs text-danger">
          {code.trim()}
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-6 flex h-48 animate-pulse items-center justify-center rounded-md border border-line text-sm text-muted">
        Rendering diagram...
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="mermaid-diagram my-6 overflow-x-auto rounded-md border border-line p-6"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
