import { NextRequest, NextResponse } from "next/server";
import { cliInstalled } from "@/lib/auth/cli";
import { loadDoc } from "@/lib/vault/store";
import { saveSheetVersion } from "@/lib/generate/save";
import { layOutOnDevice, layoutKey } from "@/lib/sheet/device-layout";
import { findBrowser } from "@/lib/sheet/pdf";
import type { SheetMeta } from "@/lib/sheet/layout";

// Lays a stored cheatsheet out on this machine, in the headless browser that
// prints it, and stores the pages with the sheet (lib/sheet/device-layout.ts).
// Answers with the stored layout straight away when it is still current, so
// opening a sheet never fits it twice.
//
// Only where the Claude Code CLI is, like Save PDF: the reader's own machine.
// Elsewhere — or with no Chromium-family browser — 501, and the preview fits
// the sheet in the reader's browser as before.
export async function POST(req: NextRequest, { params }: { params: Promise<{ folder: string; id: string }> }) {
  const { folder, id } = await params;
  let doc: Awaited<ReturnType<typeof loadDoc>>;
  try {
    doc = await loadDoc(folder, id, "sheet");
  } catch {
    return NextResponse.json({ error: "cheatsheet not found" }, { status: 404 });
  }
  const meta = doc.meta as SheetMeta | null;
  if (!meta?.spec) return NextResponse.json({ error: "cheatsheet has no layout" }, { status: 409 });
  if (meta.layout?.key === layoutKey(doc.html, meta.spec)) return NextResponse.json({ layout: meta.layout });

  const browser = cliInstalled() ? findBrowser() : null;
  if (!browser) {
    return NextResponse.json({ error: "no Chrome, Chromium, Edge or Brave on this machine to lay the sheet out with" }, { status: 501 });
  }
  try {
    const layout = await layOutOnDevice(browser, req.nextUrl.origin, doc.html, meta.spec, doc.title);
    // A reader who may only view the folder still gets the layout, just not
    // stored: the save is a write, and RLS refuses it.
    await saveSheetVersion(folder, id, null, meta.spec, (m) => ({ ...m, layout })).catch(() => {});
    return NextResponse.json({ layout });
  } catch (err: any) {
    console.error("[sheet layout]", err?.message);
    return NextResponse.json({ error: "laying the sheet out failed" }, { status: 502 });
  }
}
