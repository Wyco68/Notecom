// The pictures inside an upload, offered to a /lect run.
//
// markitdown turns slides into text and drops every picture, so a slide that
// is only a diagram or a photo used to come out as "the slide is only a
// picture". The pictures themselves are in the file: a .pptx or .docx is a
// zip with them under ppt/media or word/media, and a PDF's are pulled out by
// poppler's `pdfimages`. They are written beside the upload under names that
// say which slide they came from, so the run can look at the ones it needs
// and place them by name; the save step (./save.ts) uploads only the ones the
// lesson uses.
//
// No image library: the pictures keep their own format, and the size comes
// from the file header — all a page needs to reserve the space before the
// picture loads.

import { execFile } from "child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import path from "path";
import { inflateRawSync } from "zlib";

export interface SlideImage {
  /** the name the run uses for it, e.g. slide-07-1.png */
  name: string;
  path: string;
  /** slide (or PDF page) it sits on; 0 when the format has no slides */
  slide: number;
  width: number;
  height: number;
  mime: ImageMime;
}

export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export const IMAGE_EXT: Record<ImageMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

// Logos, bullets and template decoration: too small to teach anything.
const MIN_SIDE = 120;
const MIN_BYTES = 6 * 1024;
// A picture on more slides than this is the deck's template, not content.
const MAX_REPEAT = 3;
// Bounds a deck full of photos: past this, the run would spend more on looking
// than the lesson gains.
const MAX_IMAGES = 120;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Pulls the pictures out of `file` into `dir`. Never fails the run: a format
 * with no pictures, or a PDF on a machine without poppler, gives an empty
 * list and the lesson is written from the text alone.
 */
export async function extractSlideImages(file: string, dir: string): Promise<SlideImage[]> {
  await mkdir(dir, { recursive: true });
  const ext = path.extname(file).toLowerCase();
  let found: Array<{ slide: number; data: Buffer }> = [];
  try {
    if (ext === ".pptx") found = officeImages(await readFile(file), "ppt");
    else if (ext === ".docx") found = officeImages(await readFile(file), "word");
    else if (ext === ".pdf") found = await pdfImages(file, dir);
    else if (/^\.(png|jpe?g|gif|webp)$/.test(ext)) found = [{ slide: 1, data: await readFile(file) }];
  } catch {
    return [];
  }

  const images: SlideImage[] = [];
  const perSlide = new Map<number, number>();
  for (const { slide, data } of found) {
    if (images.length >= MAX_IMAGES) break;
    if (data.length < MIN_BYTES || data.length > MAX_IMAGE_BYTES) continue;
    const info = imageInfo(data);
    if (!info || Math.min(info.width, info.height) < MIN_SIDE) continue;
    const n = (perSlide.get(slide) ?? 0) + 1;
    perSlide.set(slide, n);
    const name = `slide-${String(slide).padStart(2, "0")}-${n}.${IMAGE_EXT[info.mime]}`;
    const out = path.join(dir, name);
    await writeFile(out, data);
    images.push({ name, path: out, slide, ...info });
  }
  return images;
}

/** One line per picture, for the run's prompt file. */
export function imageIndex(images: SlideImage[]): string {
  return images
    .map((i) => `${i.name}\t${i.slide ? `slide ${i.slide}` : "document"}\t${i.width}x${i.height}`)
    .join("\n");
}

// --- formats ------------------------------------------------------------------

/** Format and size from the header; null for anything a browser can't show. */
export function imageInfo(b: Buffer): { mime: ImageMime; width: number; height: number } | null {
  if (b.length < 32) return null;
  if (b.readUInt32BE(0) === 0x89504e47) {
    return { mime: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.toString("ascii", 0, 3) === "GIF") {
    return { mime: "image/gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const chunk = b.toString("ascii", 12, 16);
    if (chunk === "VP8 ") return { mime: "image/webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { mime: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { mime: "image/webp", width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    // Walk the segments to the frame header (SOF0..SOF15 bar DHT/JPG/DAC).
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { mime: "image/jpeg", width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

/**
 * The pictures of an Office file, each with the slide it is on: a slide's
 * relationships file names the media it uses. A Word document has no slides,
 * so its pictures are numbered in order instead.
 */
function officeImages(zipData: Buffer, root: "ppt" | "word"): Array<{ slide: number; data: Buffer }> {
  const zip = readZip(zipData);
  const media = new Map<string, Buffer>();
  for (const [name, read] of zip) if (name.startsWith(`${root}/media/`)) media.set(name, read());

  if (root === "word") {
    return [...media.keys()]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((name) => ({ slide: 0, data: media.get(name)! }));
  }

  const onSlides = new Map<string, number[]>();
  for (const [name, read] of zip) {
    const m = /^ppt\/slides\/_rels\/slide(\d+)\.xml\.rels$/.exec(name);
    if (!m) continue;
    for (const t of read().toString("utf8").matchAll(/Target="\.\.\/media\/([^"]+)"/g)) {
      const key = `ppt/media/${t[1]}`;
      onSlides.set(key, [...(onSlides.get(key) ?? []), Number(m[1])]);
    }
  }
  const out: Array<{ slide: number; data: Buffer }> = [];
  for (const [key, slides] of onSlides) {
    const data = media.get(key);
    if (!data || slides.length > MAX_REPEAT) continue;
    out.push({ slide: Math.min(...slides), data });
  }
  return out.sort((a, b) => a.slide - b.slide);
}

/** Embedded pictures of a PDF, by page, via `pdfimages -png -p`. */
async function pdfImages(file: string, dir: string): Promise<Array<{ slide: number; data: Buffer }>> {
  const work = path.join(dir, "pdf");
  await mkdir(work, { recursive: true });
  try {
    await new Promise<void>((resolve, reject) =>
      execFile("pdfimages", ["-png", "-p", file, path.join(work, "img")], { timeout: 120_000 }, (err) =>
        err ? reject(err) : resolve()
      )
    );
    const out: Array<{ slide: number; data: Buffer }> = [];
    for (const name of (await readdir(work)).sort()) {
      const m = /^img-(\d+)-\d+\.png$/.exec(name);
      if (m) out.push({ slide: Number(m[1]), data: await readFile(path.join(work, name)) });
    }
    return out;
  } catch {
    // No poppler on this machine: the lesson comes from the text alone.
    return [];
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * A zip's entries by name, each read on demand. Just enough of the format for
 * an Office file: stored and deflated entries, read through the central
 * directory (local headers can leave the sizes out).
 */
function readZip(b: Buffer): Map<string, () => Buffer> {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a zip file");
  const count = b.readUInt16LE(eocd + 10);
  let at = b.readUInt32LE(eocd + 16);
  const entries = new Map<string, () => Buffer>();
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(at) !== 0x02014b50) break;
    const method = b.readUInt16LE(at + 10);
    const size = b.readUInt32LE(at + 20);
    const nameLen = b.readUInt16LE(at + 28);
    const extraLen = b.readUInt16LE(at + 30);
    const commentLen = b.readUInt16LE(at + 32);
    const local = b.readUInt32LE(at + 42);
    const name = b.toString("utf8", at + 46, at + 46 + nameLen);
    entries.set(name, () => {
      const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
      const raw = b.subarray(start, start + size);
      return method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
