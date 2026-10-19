// A cheatsheet laid out once, on the machine that prints it, and stored.
//
// The preview used to fit the sheet in the app's own window every time it was
// opened — trying 2 to 8 columns and every font, seconds of work — and the PDF
// was then printed by a different browser (WebKit lays out the Linux app,
// Chromium prints), which measures text a little differently: columns ended
// early or ran long in the PDF. Now the fitting runs once per version in the
// headless browser that prints (lib/sheet/pdf.ts, app/sheet-engine), and the
// finished pages are stored in the sheet's meta. Opening the sheet shows them
// as they are; Save PDF prints exactly them.
//
// The key ties a stored layout to what it was made from: the fragment, the
// spec, the page styles and this engine's version. Any of those changing makes
// it stale, and the next open lays the sheet out again.

import { createHash } from "crypto";
import { readMedia } from "@/lib/vault/store";
import { sheetStyles, type SheetSpec, type StoredLayout } from "./layout";
import { layOutInBrowser } from "./pdf";

/** Bumped when the paginator or fitter changes what a layout comes out as. */
const ENGINE = "2";

export function layoutKey(html: string, spec: SheetSpec): string {
  const { from, to, pages, layout, columns } = spec;
  return createHash("sha256")
    .update(JSON.stringify({ ENGINE, from, to, pages, layout, columns: columns ?? null }))
    .update("\0")
    .update(sheetStyles(spec.layout))
    .update("\0")
    .update(html)
    .digest("hex");
}

/**
 * The sheet's pictures as data: URLs, read as the caller: a headless browser
 * has no session to fetch /api/media with, and a printed page loads nothing.
 * `restore` turns them back into their app paths in what comes out.
 */
export async function inlinePictures(html: string): Promise<{ html: string; restore: (s: string) => string }> {
  const srcs = [...new Set([...html.matchAll(/\bsrc="(\/api\/media\/[^"]+)"/g)].map((m) => m[1]))];
  const read = await Promise.all(srcs.map(async (src) => [src, await readMedia(src)] as const));
  const pairs = read.map(([src, media]) => [src, media ? `data:${media.type};base64,${media.data.toString("base64")}` : ""] as const);
  let out = html;
  for (const [src, data] of pairs) out = out.split(`src="${src}"`).join(`src="${data}"`);
  return {
    html: out,
    restore: (s) => {
      let back = s;
      for (const [src, data] of pairs) if (data) back = back.split(`src="${data}"`).join(`src="${src}"`);
      return back;
    },
  };
}

/** Fits the sheet in `browser` through the app's layout page at `origin`. */
export async function layOutOnDevice(
  browser: string,
  origin: string,
  html: string,
  spec: SheetSpec,
  title: string
): Promise<StoredLayout> {
  const { html: body, restore } = await inlinePictures(html);
  const out = await layOutInBrowser<{
    html: string;
    pages: number;
    font: number;
    columns: number;
    lineHeight: number;
    fill: number;
    issues: StoredLayout["issues"];
  }>(browser, `${origin}/sheet-engine`, { body, spec, title });
  return {
    key: layoutKey(html, spec),
    html: restore(out.html),
    pages: out.pages,
    font: out.font,
    columns: out.columns,
    lineHeight: out.lineHeight,
    fill: out.fill,
    issues: out.issues,
    at: new Date().toISOString(),
  };
}
