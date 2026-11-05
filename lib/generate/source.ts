// Turns an upload into what a web service can read. PDFs and pictures go as
// they are (every supported service reads both natively); Markdown and text
// as text; a slide deck or Word file as its text, pulled out of the zip in
// place — no service reads .pptx or .docx, and the hosted server has no
// converter to make a PDF of them.

import path from "path";
import { imageInfo, readZip } from "./media";
import type { Part } from "../ai/core";

export class SourceError extends Error {}

const TEXT = new Set([".md", ".markdown", ".txt"]);
const IMAGE = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export function sourceParts(data: Buffer, name: string): { parts: Part[]; summary: string } {
  const ext = path.extname(name).toLowerCase();

  if (ext === ".pdf") {
    if (data.subarray(0, 5).toString("latin1") !== "%PDF-") throw new SourceError("That file isn't a readable PDF.");
    return { parts: [{ kind: "pdf", data: data.toString("base64"), name }], summary: "PDF" };
  }

  if (IMAGE.has(ext)) {
    const info = imageInfo(data);
    if (!info) throw new SourceError("That picture couldn't be read. Use PNG, JPEG, GIF or WebP.");
    return { parts: [{ kind: "image", data: data.toString("base64"), mime: info.mime }], summary: "picture" };
  }

  if (TEXT.has(ext)) {
    const text = data.toString("utf8").trim();
    if (!text) throw new SourceError("That file is empty.");
    tooLong(text.length);
    return { parts: [{ kind: "text", text: `Source file "${name}":\n\n${text}` }], summary: "text" };
  }

  if (ext === ".pptx" || ext === ".docx") {
    let sections: string[][];
    try {
      const zip = readZip(data);
      const doc = zip.get("word/document.xml");
      sections = ext === ".pptx" ? slideText(zip) : [paragraphs(doc ? xmlOf(doc()) : "", "w")];
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw new SourceError("That file couldn't be opened. Save it again, or export it as PDF.");
    }
    const body = sections
      .map((lines, i) => (ext === ".pptx" ? `## Slide ${i + 1}\n` : "") + lines.join("\n"))
      .filter((s) => s.replace(/^## Slide \d+\n/, "").trim())
      .join("\n\n");
    if (!body.trim()) {
      throw new SourceError("No text could be read from that file. Export it as PDF and upload that instead.");
    }
    tooLong(body.length);
    const summary = ext === ".pptx" ? `slides, ${sections.length} with text read` : "Word document, text read";
    return {
      parts: [
        {
          kind: "text",
          text:
            `Source file "${name}", converted to text by the app (pictures are not included):\n\n` + body,
        },
      ],
      summary,
    };
  }

  throw new SourceError("Upload a PDF, slide deck (.pptx), Word file (.docx), picture or Markdown file.");
}

// Far more than a lecture holds, and well inside every model's context: a
// file past this would fail at the service after waiting in the queue.
const MAX_TEXT_CHARS = 400_000;

function tooLong(chars: number) {
  if (chars > MAX_TEXT_CHARS) {
    throw new SourceError("That file has too much text for one lesson. Split it, or upload part of it.");
  }
}

const MAX_SLIDES = 600;
// One slide's or one document's XML; a real one is a few hundred KB at most.
const MAX_XML_BYTES = 8 * 1024 * 1024;

/** Each slide's text, in slide order. Stops early once the text is too long. */
function slideText(zip: Map<string, () => Buffer>): string[][] {
  const slides = [...zip.keys()]
    .map((k) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(k))
    .filter((m): m is RegExpExecArray => !!m)
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  if (slides.length > MAX_SLIDES) throw new SourceError("That deck has too many slides for one lesson. Split it.");
  const out: string[][] = [];
  let total = 0;
  for (const m of slides) {
    const lines = paragraphs(xmlOf(zip.get(m[0])!()), "a");
    total += lines.reduce((n, l) => n + l.length + 1, 0);
    tooLong(total);
    out.push(lines);
  }
  return out;
}

function xmlOf(data: Buffer): string {
  if (data.length > MAX_XML_BYTES) throw new SourceError("That file is too large to read. Export it as PDF instead.");
  return data.toString("utf8");
}

/**
 * The text of every paragraph (`<a:p>` or `<w:p>`), one line each. One linear
 * pass over text runs and paragraph ends: no pattern here can backtrack, so a
 * hostile file costs time in proportion to its size and no more.
 */
function paragraphs(xml: string, ns: "a" | "w"): string[] {
  const lines: string[] = [];
  const token = new RegExp(`<${ns}:t(?:\\s[^<>]*)?>([^<]*)</${ns}:t>|</${ns}:p>`, "g");
  let line = "";
  for (const m of xml.matchAll(token)) {
    if (m[1] !== undefined) {
      line += decode(m[1]);
    } else {
      if (line.trim()) lines.push(line.trim());
      line = "";
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function codePoint(n: number): string {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
}

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => codePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
