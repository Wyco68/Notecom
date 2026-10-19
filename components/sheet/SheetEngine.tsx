"use client";

import { useEffect } from "react";
import { sheetDocument, type SheetSpec } from "@/lib/sheet/layout";
import { fitSheet } from "@/lib/sheet/fit";

// Exposes the preview's own paginator and fitter to a headless browser, so a
// sheet is laid out by the engine that prints it (lib/sheet/device-layout.ts).
// The server calls window.__sheetLayout over the DevTools protocol with the
// fragment (pictures inlined), and reads back the finished pages.

declare global {
  interface Window {
    __sheetLayout?: (input: { body: string; spec: SheetSpec; title: string }) => Promise<unknown>;
  }
}

export default function SheetEngine() {
  useEffect(() => {
    window.__sheetLayout = async ({ body, spec, title }) => {
      const frame = document.createElement("iframe");
      // Same box as the preview: no scripts in the sheet, reachable from here.
      frame.setAttribute("sandbox", "allow-same-origin");
      frame.style.cssText = "position:absolute;left:0;top:0;width:1200px;height:1200px;border:0";
      const loaded = new Promise<void>((resolve) => (frame.onload = () => resolve()));
      frame.srcdoc = sheetDocument(body, spec.layout, title);
      document.body.appendChild(frame);
      await loaded;
      const doc = frame.contentDocument!;
      await doc.fonts?.ready;
      const fit = await fitSheet(doc, spec);
      const html = doc.getElementById("pages")!.innerHTML;
      frame.remove();
      return { html, ...fit };
    };
    return () => {
      delete window.__sheetLayout;
    };
  }, []);
  return null;
}
