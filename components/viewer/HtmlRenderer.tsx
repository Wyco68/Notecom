"use client";

import { createElement, Fragment, type ReactNode } from "react";
import Callout, { detectCalloutKind } from "./Callout";
import Mermaid from "./Mermaid";
import ProcessFlow, { type ProcessFlowData } from "./visualizations/ProcessFlow";
import Timeline, { type TimelineData } from "./visualizations/Timeline";
import LayerStack, { type LayerStackData } from "./visualizations/LayerStack";
import BlockDiagram, { type BlockDiagramData } from "./visualizations/BlockDiagram";
import VizRenderer from "./VizRenderer";

// Renders Claude's sanitized HTML into React. The HTML is already structured
// and styling-free; this component owns all presentation, intercepting element
// types for richer rendering:
//   - <blockquote> beginning with a callout label    -> colored Callout box
//   - <div class="mermaid">                          -> client-side Mermaid SVG
//   - <div class="viz">  JSON {type,title?,data}     -> VizRenderer + registry dispatch
//   - <div class="viz-*"> legacy JSON                -> legacy viz component (backward compat)

// Tags we render as plain elements. Anything else is skipped (its text kept).
const PASS_THROUGH = new Set([
  "h1", "h2", "h3",
  "p", "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "td", "th",
  "pre", "code", "strong", "em", "div",
]);

// Table-structure tags only ever take element children — any text node
// between them is pure source whitespace (newlines/indentation from the
// generated HTML), and HTML forbids text directly inside these as a hydration
// error. Drop it; it carries no visible content.
const TABLE_STRUCTURE = new Set(["table", "thead", "tbody", "tr"]);

function parseVizAs<T>(el: HTMLElement): T | null {
  try {
    return JSON.parse(el.textContent ?? "{}") as T;
  } catch {
    return null;
  }
}

function parseVizPayload(
  el: HTMLElement
): { type: string; title?: string; data: unknown } | null {
  try {
    const parsed = JSON.parse(el.textContent ?? "{}") as Record<string, unknown>;
    if (typeof parsed.type !== "string") return null;
    return {
      type: parsed.type,
      title: typeof parsed.title === "string" ? parsed.title : undefined,
      data: parsed.data ?? {},
    };
  } catch {
    return null;
  }
}

function nodeToReact(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  // Mermaid diagram.
  if (tag === "div" && el.classList.contains("mermaid")) {
    return <Mermaid key={key} code={el.textContent ?? ""} />;
  }

  // Unified viz dispatch (new format: class="viz" with JSON {type, title?, data}).
  if (tag === "div" && el.classList.contains("viz")) {
    const payload = parseVizPayload(el);
    return payload ? (
      <VizRenderer key={key} type={payload.type} title={payload.title} data={payload.data} />
    ) : null;
  }

  // Legacy viz components (backward compat with viz-* class names).
  if (tag === "div" && el.classList.contains("viz-process-flow")) {
    const data = parseVizAs<ProcessFlowData>(el);
    return data ? <ProcessFlow key={key} data={data} /> : null;
  }
  if (tag === "div" && el.classList.contains("viz-timeline")) {
    const data = parseVizAs<TimelineData>(el);
    return data ? <Timeline key={key} data={data} /> : null;
  }
  if (tag === "div" && el.classList.contains("viz-layer-stack")) {
    const data = parseVizAs<LayerStackData>(el);
    return data ? <LayerStack key={key} data={data} /> : null;
  }
  if (tag === "div" && el.classList.contains("viz-block-diagram")) {
    const data = parseVizAs<BlockDiagramData>(el);
    return data ? <BlockDiagram key={key} data={data} /> : null;
  }

  // Callout blockquote.
  if (tag === "blockquote") {
    const text = el.textContent ?? "";
    const kind = detectCalloutKind(text);
    if (kind) {
      const stripped = text.slice(text.indexOf(":") + 1).trim();
      return (
        <Callout key={key} kind={kind}>
          {stripped}
        </Callout>
      );
    }
    return <blockquote key={key}>{childrenToReact(el)}</blockquote>;
  }

  // "Concept: <Name>" headings start a new major section — set them apart
  // from the plain repeated sub-headings (How it Works, Example, etc.) with
  // distinct size/color instead of identical h2 styling.
  if (tag === "h2" && /^Concept:/.test(el.textContent ?? "")) {
    return (
      <h2
        key={key}
        className="!mt-14 !text-4xl !font-bold !text-blue-700 dark:!text-blue-300"
      >
        {childrenToReact(el)}
      </h2>
    );
  }

  // "Overview" is the lesson's opening section — set apart with its own
  // color, same treatment as Concept headings.
  if (tag === "h2" && (el.textContent ?? "").trim() === "Overview") {
    return (
      <h2
        key={key}
        className="!mt-2 !text-4xl !font-bold !text-purple-700 dark:!text-purple-300"
      >
        {childrenToReact(el)}
      </h2>
    );
  }

  // Code blocks get the project's blue accent instead of Tailwind
  // Typography's default near-black — same palette as Callout/Mermaid.
  if (tag === "pre") {
    return (
      <pre
        key={key}
        className="!border !border-blue-200 !bg-blue-50 !text-blue-900 dark:!border-blue-800/50 dark:!bg-blue-950/20 dark:!text-blue-100"
      >
        {childrenToReact(el)}
      </pre>
    );
  }

  // A wide table would push the whole page sideways on a narrow screen, so it
  // scrolls inside its own box instead.
  if (tag === "table") {
    return (
      <div key={key} className="overflow-x-auto">
        <table>{childrenToReact(el)}</table>
      </div>
    );
  }

  if (PASS_THROUGH.has(tag)) {
    return createElement(tag, { key }, childrenToReact(el));
  }

  // Unknown tag: drop the wrapper, keep its children.
  return <Fragment key={key}>{childrenToReact(el)}</Fragment>;
}

function childrenToReact(el: Node): ReactNode[] {
  const tag = el.nodeType === Node.ELEMENT_NODE ? (el as HTMLElement).tagName.toLowerCase() : "";
  const isTableStructure = TABLE_STRUCTURE.has(tag);

  return Array.from(el.childNodes)
    .filter((child) => {
      if (!isTableStructure) return true;
      return !(child.nodeType === Node.TEXT_NODE && !child.textContent?.trim());
    })
    .map((child, i) => nodeToReact(child, i));
}

export default function HtmlRenderer({ html }: { html: string }) {
  // Parse on the client; DOMParser is available in the browser.
  const doc =
    typeof window !== "undefined"
      ? new DOMParser().parseFromString(html, "text/html")
      : null;

  return (
    <div className="prose prose-base sm:prose-lg dark:prose-invert max-w-none prose-headings:font-semibold prose-h1:text-3xl sm:prose-h1:text-5xl prose-h2:text-2xl prose-h3:text-xl prose-p:text-base sm:prose-p:text-lg prose-li:text-base sm:prose-li:text-lg prose-table:text-sm sm:prose-table:text-base">
      {doc ? childrenToReact(doc.body) : null}
    </div>
  );
}
