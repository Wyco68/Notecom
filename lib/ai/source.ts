// Turns an upload into what a web service can read, in the reader's browser.
// PDFs and pictures go as they are (every supported service reads both);
// Markdown and text as text; a slide deck or Word file as its text, pulled out
// of the zip here — no service reads .pptx or .docx.
//
// It only ever reads the reader's own file in their own tab, but it is still
// bounded, so a broken or hostile file fails fast instead of hanging the page.

import type { Part } from "./core";

export class SourceError extends Error {}

export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 400_000;
const MAX_SLIDES = 600;
const MAX_ENTRIES = 2000;
const MAX_XML_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

const TEXT = /\.(md|markdown|txt)$/i;
const IMAGE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

export async function sourceParts(file: File): Promise<{ parts: Part[]; summary: string }> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new SourceError(`That file is over ${MAX_SOURCE_BYTES / (1024 * 1024)} MB. Export a smaller PDF.`);
  }
  const name = file.name;
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (ext === "pdf") {
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") throw new SourceError("That file isn't a readable PDF.");
    return { parts: [{ kind: "pdf", data: base64(bytes), name }], summary: "PDF" };
  }

  if (IMAGE[ext]) {
    return { parts: [{ kind: "image", data: base64(bytes), mime: IMAGE[ext] }], summary: "picture" };
  }

  if (TEXT.test(name)) {
    const text = new TextDecoder().decode(bytes).trim();
    if (!text) throw new SourceError("That file is empty.");
    tooLong(text.length);
    return { parts: [{ kind: "text", text: `Source file "${name}":\n\n${text}` }], summary: "text" };
  }

  if (ext === "pptx" || ext === "docx") {
    let sections: string[][];
    try {
      const zip = readZip(bytes);
      if (ext === "pptx") {
        sections = await slideText(zip);
      } else {
        const doc = zip.get("word/document.xml");
        sections = [paragraphs(doc ? xmlOf(await doc()) : "", "w")];
      }
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw new SourceError("That file couldn't be opened. Save it again, or export it as PDF.");
    }
    const body = sections
      .map((lines, i) => (ext === "pptx" ? `## Slide ${i + 1}\n` : "") + lines.join("\n"))
      .filter((s) => s.replace(/^## Slide \d+\n/, "").trim())
      .join("\n\n");
    if (!body.trim()) throw new SourceError("No text could be read from that file. Export it as PDF and upload that instead.");
    tooLong(body.length);
    return {
      parts: [{ kind: "text", text: `Source file "${name}", converted to text (pictures are not included):\n\n${body}` }],
      summary: ext === "pptx" ? `slides, ${sections.length} with text read` : "Word document, text read",
    };
  }

  throw new SourceError("Upload a PDF, slide deck (.pptx), Word file (.docx), picture or Markdown file.");
}

function tooLong(chars: number) {
  if (chars > MAX_TEXT_CHARS) throw new SourceError("That file has too much text for one lesson. Split it.");
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function slideText(zip: Map<string, () => Promise<Uint8Array>>): Promise<string[][]> {
  const slides = [...zip.keys()]
    .map((k) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(k))
    .filter((m): m is RegExpExecArray => !!m)
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  if (slides.length > MAX_SLIDES) throw new SourceError("That deck has too many slides for one lesson. Split it.");
  const out: string[][] = [];
  let total = 0;
  for (const m of slides) {
    const lines = paragraphs(xmlOf(await zip.get(m[0])!()), "a");
    total += lines.reduce((n, l) => n + l.length + 1, 0);
    tooLong(total);
    out.push(lines);
  }
  return out;
}

function xmlOf(data: Uint8Array): string {
  if (data.length > MAX_XML_BYTES) throw new SourceError("That file is too large to read. Export it as PDF instead.");
  return new TextDecoder().decode(data);
}

/** Every paragraph's text, one line each, in one linear pass. */
function paragraphs(xml: string, ns: "a" | "w"): string[] {
  const lines: string[] = [];
  const token = new RegExp(`<${ns}:t(?:\\s[^<>]*)?>([^<]*)</${ns}:t>|</${ns}:p>`, "g");
  let line = "";
  for (const m of xml.matchAll(token)) {
    if (m[1] !== undefined) line += decode(m[1]);
    else {
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

/**
 * A zip's entries by name, each read on demand — enough of the format for an
 * Office file, bounded like the server's reader in lib/generate/media.ts.
 * Inflating uses the browser's own DecompressionStream.
 */
function readZip(b: Uint8Array): Map<string, () => Promise<Uint8Array>> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a zip file");
  const count = v.getUint16(eocd + 10, true);
  if (count > MAX_ENTRIES) throw new Error("too many entries");
  let at = v.getUint32(eocd + 16, true);
  const entries = new Map<string, () => Promise<Uint8Array>>();
  const seen = new Set<number>();
  let budget = MAX_ARCHIVE_BYTES;
  for (let n = 0; n < count; n++) {
    if (at + 46 > b.length || v.getUint32(at, true) !== 0x02014b50) break;
    const method = v.getUint16(at + 10, true);
    const size = v.getUint32(at + 20, true);
    const declared = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true);
    const commentLen = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    if (at + 46 + nameLen > b.length) break;
    const name = new TextDecoder().decode(b.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (seen.has(local)) throw new Error("entries share data");
    seen.add(local);
    if (local + 30 > b.length) throw new Error("entry outside the file");
    entries.set(name, async () => {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      if (start + size > b.length) throw new Error("entry outside the file");
      const raw = b.subarray(start, start + size);
      const cap = Math.min(declared, MAX_XML_BYTES, budget);
      const out = method === 8 ? await inflate(raw, cap) : raw.slice();
      if (out.length > cap) throw new Error("entry too large");
      budget -= out.length;
      return out;
    });
  }
  return entries;
}

async function inflate(raw: Uint8Array, cap: number): Promise<Uint8Array> {
  const stream = new Blob([raw.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > cap) {
      await reader.cancel();
      throw new Error("entry too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
