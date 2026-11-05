import { NextRequest, NextResponse, after } from "next/server";
import { VERIFIED_USER_HEADER } from "@/middleware";
import { isWebService, type WebService } from "@/lib/ai/services";
import { listKeys, vaultReady } from "@/lib/ai/vault";
import { activeSheetJob, enqueue, ownUploadPath, publicJob, QueueFullError, recentJobs, sweepUploads, type JobKind, type Upload } from "@/lib/jobs/queue";
import { runJob } from "@/lib/jobs/run";
import { sectionsOf } from "@/lib/generate/sheet";
import { layoutFor, MAX_COLUMNS, MAX_PAGES, MIN_COLUMNS, type SourceRef } from "@/lib/sheet/layout";
import { openStoredSheet } from "@/lib/sheet/stored";
import { listFolderDocs, loadDoc, resolveWritableFolderId } from "@/lib/vault/store";

// Web-service runs, as jobs in the outbox (lib/jobs). POST files one and
// starts working on it after answering; GET lists the reader's recent ones.
// The work itself happens one AI call at a time (lib/jobs/run.ts), so the
// job survives this request ending, a reload or a closed tab.

export const maxDuration = 300;

const SAFE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_CHAPTERS = 40;
const MAX_MESSAGE = 4000;
const MAX_NOTE = 2000;
const MAX_REFS = 40;
const MAX_UPLOADS = 5;

export async function GET(req: NextRequest) {
  const owner = req.headers.get(VERIFIED_USER_HEADER);
  if (!owner) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const jobs = await recentJobs();
  // Asked once per page load: a good moment to clear uploads no job will read.
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
  after(() => sweepUploads(owner, active).catch(() => {}));
  return NextResponse.json({ jobs: jobs.map(publicJob) }, { headers: { "Cache-Control": "no-store" } });
}

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  const owner = req.headers.get(VERIFIED_USER_HEADER);
  if (!owner) return bad("sign in required", 401);
  if (!vaultReady()) return bad("web generation isn't set up on this server yet", 503);

  const body = await req.json().catch(() => null);
  const kind = String(body?.kind ?? "");
  const folder = String(body?.folder ?? "");
  const service = body?.service;
  if (!SAFE.test(folder)) return bad("invalid folder");
  if (!isWebService(service)) return bad("pick a service");

  const saved = (await listKeys()).find((k) => k.service === service);
  if (!saved) return bad("add a key for that service first", 409);
  if (!saved.model) return bad("pick a model for that service first", 409);

  const rawUploads: unknown[] = Array.isArray(body?.uploads) ? body.uploads.slice(0, MAX_UPLOADS) : [];
  const uploads: Upload[] = [];
  for (const u of rawUploads) {
    const path = (u as any)?.path;
    const name = String((u as any)?.name ?? "").slice(0, 200);
    if (!ownUploadPath(owner, path) || !name) return bad("invalid upload");
    uploads.push({ path, name });
  }

  const folderId = await resolveWritableFolderId(folder);
  if (!folderId) return bad("folder not found", 404);

  let jobKind: JobKind;
  let params: Record<string, unknown> = { folder, uploads };

  switch (kind) {
    case "lesson":
    case "quiz": {
      if (uploads.length !== 1) return bad("upload one file");
      jobKind = kind;
      break;
    }
    case "pictures": {
      const lesson = String(body?.lesson ?? "");
      if (!DOC_ID.test(lesson) || uploads.length !== 1) return bad("pick a lesson and upload its slides");
      const { lessons } = await listFolderDocs(folder);
      if (!lessons.some((l) => l.id === lesson)) return bad("lesson not found", 404);
      jobKind = "pictures";
      params = { ...params, docKey: lesson };
      break;
    }
    case "sheet-new": {
      const from = Number(body?.from);
      const to = Number(body?.to);
      const pages = Number(body?.pages);
      const columns = body?.columns === undefined || body?.columns === "" ? undefined : Number(body.columns);
      if (![from, to, pages].every(Number.isInteger) || from < 1 || to < from || pages < 0 || pages > MAX_PAGES) {
        return bad("invalid chapter range or page limit");
      }
      if (columns !== undefined && !(Number.isInteger(columns) && columns >= MIN_COLUMNS && columns <= MAX_COLUMNS)) {
        return bad(`columns must be ${MIN_COLUMNS} to ${MAX_COLUMNS}`);
      }
      if (to - from + 1 > MAX_CHAPTERS) return bad(`at most ${MAX_CHAPTERS} chapters per sheet`);
      const chapters = (await listFolderDocs(folder)).lessons.filter((l) => l.seq >= from && l.seq <= to).map((l) => l.seq).sort((a, b) => a - b);
      if (!chapters.length) return bad("no lessons in that range", 404);
      const first = chapters[0];
      const last = chapters[chapters.length - 1];
      jobKind = "sheet-write";
      params = {
        ...params,
        order: chapters,
        spec: {
          from: first,
          to: last,
          pages,
          layout: layoutFor(pages),
          ...(columns && !pages ? { columns } : {}),
          title: `${folder}-cheatsheet-ch${first}-${last}`,
        },
      };
      break;
    }
    case "sheet-continue":
    case "sheet-edit":
    case "sheet-review":
    case "sheet-sources": {
      const id = String(body?.sheet ?? "");
      if (!DOC_ID.test(id)) return bad("invalid sheet");
      const sheet = await openStoredSheet(req, folder, id, false);
      if (sheet instanceof NextResponse) return sheet;
      if (await activeSheetJob(id)) return bad("this cheatsheet is already being worked on — wait for that to finish", 409);
      const { spec } = sheet.meta;
      const inRange = (await listFolderDocs(folder)).lessons.filter((l) => l.seq >= spec.from && l.seq <= spec.to).map((l) => l.seq).sort((a, b) => a - b);
      params = { ...params, docKey: id, spec };

      if (kind === "sheet-continue") {
        const present = sectionsOf(sheet.html);
        const order = (sheet.meta.pending?.length ? sheet.meta.pending : inRange).filter(
          (seq) => inRange.includes(seq) && (sheet.meta.pending?.includes(seq) || !present.has(seq))
        );
        if (!order.length) return bad("every chapter is already written", 409);
        jobKind = "sheet-write";
        params = { ...params, order };
      } else if (kind === "sheet-review") {
        const reviewed = sheet.meta.review?.reviewed ?? [];
        const order = inRange.filter((seq) => body?.all || !reviewed.includes(seq));
        if (!order.length) return bad("every chapter is already reviewed", 409);
        jobKind = "sheet-review";
        params = { ...params, order };
      } else if (kind === "sheet-edit") {
        const message = typeof body?.message === "string" ? body.message.trim() : "";
        if (!message || message.length > MAX_MESSAGE) return bad(`write a message of up to ${MAX_MESSAGE} characters`);
        jobKind = "sheet-edit";
        params = { ...params, request: message, history: sheet.meta.messages };
      } else {
        const picked: unknown[] = Array.isArray(body?.refs) ? body.refs.slice(0, MAX_REFS) : [];
        const note = String(body?.note ?? "").trim().slice(0, MAX_NOTE);
        const kept = spec.extra ?? [];
        const addRefs: SourceRef[] = [];
        for (const r of picked as any[]) {
          if ((r?.kind !== "lesson" && r?.kind !== "quiz") || typeof r?.id !== "string" || !DOC_ID.test(r.id)) continue;
          if (kept.some((k) => k.kind === r.kind && k.id === r.id)) continue;
          try {
            const doc = await loadDoc(folder, r.id, r.kind);
            addRefs.push({ kind: r.kind, id: r.id, title: doc.title });
          } catch {
            // A document deleted since it was picked: skipped, as for the CLI.
          }
        }
        if (!addRefs.length && !uploads.length) return bad("pick a document or upload a file to add");
        const names = [...addRefs.map((r) => `${r.kind} "${r.title}"`), ...uploads.map((u) => `file "${u.name}"`)];
        jobKind = "sheet-edit";
        params = {
          ...params,
          addRefs,
          history: sheet.meta.messages,
          request:
            `Add what these new sources say to the sheet, in the chapter each fact belongs to: ${names.join(", ")}.` +
            (note ? `\n\n${note}` : ""),
        };
      }
      break;
    }
    default:
      return bad("unknown kind");
  }

  let id: string;
  try {
    id = await enqueue(folderId, jobKind, service as WebService, saved.model, params);
  } catch (err) {
    if (err instanceof QueueFullError) return bad(err.message, 429);
    throw err;
  }
  // Start now, after answering: the reader needn't keep the page open for
  // this first stretch, and the page continues it if it needs more time.
  after(() => runJob(id, Date.now() + (maxDuration - 20) * 1000).catch((err) => console.error("[jobs] run failed:", err?.message)));
  return NextResponse.json({ jobId: id });
}
