// A job's params, checked again by the worker before it acts on them.
//
// The job route builds them from a checked request, but the route is not the
// only way in: a reader can call notes_enqueue_job through the database API
// with any params they like. So the worker trusts nothing it reads from a
// job row — every value that reaches a query, a file name or a prompt is
// checked here first, and a job that fails is refused, not repaired.

import { LAYOUTS, MAX_COLUMNS, MAX_PAGES, MIN_COLUMNS } from "@/lib/sheet/layout";
import { ownUploadPath, type JobRow } from "./queue";

const SAFE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

const int = (n: unknown, lo: number, hi: number): n is number => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;
const docId = (v: unknown) => typeof v === "string" && DOC_ID.test(v);
const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;

function ref(r: any): boolean {
  return (r?.kind === "lesson" || r?.kind === "quiz") && docId(r.id) && text(r.title, 300);
}

function refs(v: unknown): boolean {
  return v === undefined || (Array.isArray(v) && v.length <= 40 && v.every(ref));
}

function spec(s: any): boolean {
  return (
    !!s &&
    typeof s === "object" &&
    int(s.from, 0, 9999) &&
    int(s.to, s.from, 9999) &&
    int(s.pages, 0, MAX_PAGES) &&
    Object.prototype.hasOwnProperty.call(LAYOUTS, s.layout) &&
    (s.columns === undefined || int(s.columns, MIN_COLUMNS, MAX_COLUMNS)) &&
    text(s.title, 200) &&
    refs(s.extra)
  );
}

function order(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0 && v.length <= 40 && v.every((n) => int(n, 0, 9999));
}

function history(v: unknown): boolean {
  return (
    v === undefined ||
    (Array.isArray(v) && v.length <= 500 && v.every((m: any) => (m?.role === "user" || m?.role === "assistant") && text(m.text, 100_000)))
  );
}

/** Null when the job's params are sound; otherwise what is wrong. */
export function badParams(job: Pick<JobRow, "kind" | "params" | "owner_id">): string | null {
  const p = job.params;
  if (!p || typeof p !== "object") return "params";
  if (typeof p.folder !== "string" || !SAFE.test(p.folder)) return "folder";
  const uploads: unknown = p.uploads ?? [];
  if (
    !Array.isArray(uploads) ||
    uploads.length > 5 ||
    !uploads.every((u: any) => ownUploadPath(job.owner_id, u?.path) && typeof u?.name === "string" && u.name.length >= 1 && u.name.length <= 200)
  ) {
    return "uploads";
  }
  switch (job.kind) {
    case "lesson":
    case "quiz":
      return uploads.length === 1 ? null : "uploads";
    case "pictures":
      return uploads.length === 1 && docId(p.docKey) ? null : "pictures";
    case "sheet-write":
      return spec(p.spec) && order(p.order) && (p.docKey === undefined || docId(p.docKey)) ? null : "sheet";
    case "sheet-review":
      return spec(p.spec) && order(p.order) && docId(p.docKey) ? null : "sheet";
    case "sheet-edit":
      return spec(p.spec) && docId(p.docKey) && text(p.request, 12_000) && p.request.trim() && history(p.history) && refs(p.addRefs)
        ? null
        : "sheet";
    default:
      return "kind";
  }
}
