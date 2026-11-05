"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useToast } from "../toast/ToastProvider";
import type { SheetSpec } from "@/lib/sheet/layout";
import { isWebService, WEB_SERVICES, type WebService } from "@/lib/ai/services";
import { discardUploads, preferredRunner, uploadForJob } from "@/lib/ai/client";

// Generation jobs, tracked above the modal that starts them.
//
// The server side was always a background job: `startJob` spawns the Claude Code
// CLI, the job lives in a process-global map, and `/api/generate/[id]` is only a
// tail of it. What tied the user to a dialog was the *client* — the SSE reader
// ran inside GenerateModal, so closing it abandoned the log, the completion
// toast and the tree refresh even though the run carried on.
//
// So the follow loop lives here instead, above the workspace: the modal is a
// view onto a job, not its owner. Close it, open a lesson, start a second run —
// the log keeps filling and the tree still refreshes when the document lands.
//
// Nothing here is persisted. A job belongs to one server process and one page
// session; on reload the provider re-attaches to whatever is still running by
// asking `/api/generate`, which is the difference between "kept running" and
// "kept running, and you can still see it".
//
// Saving is also triggered from here: a run ends "ready" with its document
// held server-side, and this POSTs it into Supabase — the save must run as the
// signed-in user, and only a request carries that session.
//
// A cheatsheet run is the same kind of job: it ends "ready" and is saved into
// its folder the same way — as a new sheet, or, for an edit from the sheet's
// chat box, as the next version of the sheet it edits.

export type JobStatus = "running" | "done" | "error" | "aborted";

export interface GenerateJob {
  id: string;
  folder: string;
  kind: "lect" | "quiz" | "sheet";
  /** what a cheatsheet run was asked for */
  sheet?: SheetSpec;
  /** set when this run edits a stored sheet: which one, and the reader's
   *  message, shown in the sheet's conversation while the run is going */
  edit?: { docKey: string; request: string };
  /** which cheatsheet step: writing chapters, an edit, or the review */
  step?: "write" | "edit" | "review";
  /** how many times this run has saved — a sheet step saves after each
   *  chapter, and the sheet's view reloads on each */
  saves?: number;
  /** the document the run was saved as, once it has been */
  saved?: { id: string; title: string };
  status: JobStatus;
  log: string[];
  tokens: { input: number; output: number };
  startedAt: number;
  /** ms timestamp of the last streamed line — drives the "still working" hint. */
  lastActivity: number;
  /** the run failed for lack of a CLI session; the UI offers sign-in */
  needsAuth?: boolean;
  /** who writes it: "Claude Code" or a web service's name */
  service?: string;
  /** a web-service job in the server's queue (lib/jobs), followed by polling
   *  its row rather than a log stream */
  queue?: boolean;
}

/**
 * How many runs may be in flight at once. Each one is a Claude Code process
 * spending real tokens, so background generation must not also mean unbounded
 * parallel generation — an accidental double-click is the common case.
 */
export const MAX_CONCURRENT_JOBS = 3;

interface GenerateJobsValue {
  jobs: GenerateJob[];
  activeCount: number;
  /** Re-rendered every second while a job runs, for elapsed/idle readouts. */
  now: number;
  /** Increments whenever a job finishes successfully — the tree's cue to refresh. */
  completedTick: number;
  /** Starts a run and returns its job id, or null when it could not start. */
  /** With `lesson`: picture mode — the slides of that saved lesson, whose
   *  pictures are added to it without rewriting it. */
  /** With `web`: a web service writes it with the reader's own key and model
   *  instead of the local Claude Code CLI. */
  start: (input: {
    file: File;
    folder: string;
    kind: "lect" | "quiz";
    lesson?: string;
    web?: { service: WebService; label: string };
  }) => Promise<string | null>;
  /** Starts a cheatsheet run over lessons `from`..`to` of a folder. */
  startSheet: (input: {
    folder: string;
    from: number;
    to: number;
    /** 0 = no page limit */
    pages: number;
    /** 2–8; undefined = the page size's own */
    columns?: number;
    files: File[];
    /** a web service writes it instead of the local CLI */
    web?: { service: WebService; label: string };
  }) => Promise<string | null>;
  /** Starts a step on a stored sheet: an edit (the chat box, "fix these"),
   *  the rest of its chapters, its review, or new sources (multipart). */
  sheetStep: (input: {
    folder: string;
    id: string;
    action: "edit" | "continue" | "review" | "sources";
    body?: Record<string, unknown> | FormData;
    /** shown as the reader's turn while it runs */
    request?: string;
  }) => Promise<string | null>;
  abort: (id: string) => void;
  /** Forget a finished job, removing it from the sidebar. */
  dismiss: (id: string) => void;
}

const Ctx = createContext<GenerateJobsValue | null>(null);

export function useGenerateJobs(): GenerateJobsValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useGenerateJobs must be used inside GenerateJobsProvider");
  return value;
}

export default function GenerateJobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<GenerateJob[]>([]);
  const [completedTick, setCompletedTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const toast = useToast();

  // One ticker for every elapsed and idle readout in the tree of components
  // below, running only while something is in flight. Each of them owning an
  // interval would be the same clock several times over.
  const activeCount = jobs.filter((j) => j.status === "running").length;
  useEffect(() => {
    if (!activeCount) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeCount]);

  const patch = useCallback((id: string, fn: (job: GenerateJob) => GenerateJob) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? fn(j) : j)));
  }, []);

  // follow() runs long after the render that created it; it reads a job's kind
  // from here rather than from a stale closure.
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  // Jobs already being followed, so a re-attach can't open a second reader on
  // the same stream (which would duplicate every log line).
  const following = useRef(new Set<string>());

  const follow = useCallback(
    async (id: string) => {
      if (following.current.has(id)) return;
      following.current.add(id);
      let status: JobStatus | "ready" = "error";
      let needsAuth = false;
      try {
        const events = await fetch(`/api/generate/${id}`);
        if (!events.ok || !events.body) throw new Error("could not follow the job");
        const reader = events.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep;
          while ((sep = buf.indexOf("\n\n")) !== -1) {
            const raw = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            const event = /^event: (.*)$/m.exec(raw)?.[1];
            const dataLine = /^data: (.*)$/m.exec(raw)?.[1];
            if (!event || !dataLine) continue;
            const payload = JSON.parse(dataLine);
            if (event === "line") {
              patch(id, (j) => ({
                ...j,
                log: [...j.log, payload.line],
                lastActivity: Date.now(),
              }));
            }
            if (event === "tokens") patch(id, (j) => ({ ...j, tokens: payload }));
            if (event === "end") {
              status = payload.status;
              needsAuth = !!payload.needsAuth;
              if (payload.tokens) patch(id, (j) => ({ ...j, tokens: payload.tokens }));
            }
          }
        }
      } catch (err: any) {
        patch(id, (j) => ({ ...j, log: [...j.log, `Error: ${err.message}`] }));
      } finally {
        following.current.delete(id);
      }

      // The stream can drop (window closed, network blip, `break` from a
      // truncated `done` with no `end` event) after the job actually finished
      // server-side. Defaulting to "error" here would both misreport a
      // successful run and skip the save below, leaving a finished document
      // that never reaches Supabase. Ask the server for the authoritative
      // status before giving up on it.
      if (status === "error") {
        try {
          const r = await fetch("/api/generate");
          const data = r.ok ? await r.json() : null;
          const job = (data?.jobs ?? []).find((j: any) => j.id === id);
          if (job && job.status !== "running") {
            status = job.status;
            needsAuth = !!job.needsAuth;
          }
        } catch {
          // Best effort — falls through to "error" below.
        }
      }

      if (status === "ready") {
        try {
          const res = await fetch(`/api/generate/${id}`, { method: "POST" });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "save failed");
          if (data.continued) {
            // A step that saves as it goes: this part is in Supabase, and the
            // run has gone on to the next. The tail replays the whole log, so
            // start it empty and follow again.
            patch(id, (j) => ({
              ...j,
              saved: { id: data.id, title: data.title },
              edit: j.edit ?? { docKey: data.id, request: "" },
              saves: (j.saves ?? 0) + 1,
              status: "running",
              log: [],
              lastActivity: Date.now(),
            }));
            setCompletedTick((n) => n + 1);
            follow(id);
            return;
          }
          patch(id, (j) => ({
            ...j,
            saved: { id: data.id, title: data.title },
            edit: j.kind === "sheet" ? (j.edit ?? { docKey: data.id, request: "" }) : j.edit,
            saves: (j.saves ?? 0) + 1,
            log: [...j.log, `Saved "${data.title}".`, "Finished."],
          }));
          status = "done";
        } catch (err: any) {
          patch(id, (j) => ({ ...j, log: [...j.log, `Save failed: ${err.message}`] }));
          status = "error";
        }
      }

      patch(id, (j) => ({ ...j, status, needsAuth }));
      // Announce the outcome here rather than in the modal: by now the reader
      // may well have closed the modal and moved on, and a finished run they
      // are not looking at is exactly the one worth announcing.
      const job = jobsRef.current.find((j) => j.id === id);
      const where = job ? job.folder.replace(/-/g, " ") : "the folder";
      if (job?.kind === "sheet") {
        const what = job.step === "review" ? "review" : job.step === "edit" ? "edit" : "writing";
        if (status === "done") {
          toast.success(
            job.step === "review"
              ? "Review finished — findings are with the sheet."
              : job.step === "edit"
                ? "Cheatsheet updated."
                : `Cheatsheet written in "${where}".`
          );
        } else if (status === "error") {
          toast.error(
            job.saves
              ? `The ${what} stopped part-way; what was done is saved — continue from the sheet.`
              : `The cheatsheet ${what} failed — see the log.`
          );
        }
      } else {
        const noun = job?.kind === "quiz" ? "quiz" : "lesson";
        if (status === "done") toast.success(`Generated ${noun} in "${where}".`);
        else if (status === "error") toast.error(`Generation failed in "${where}" — see the log.`);
      }
      if (status === "done") setCompletedTick((n) => n + 1);
    },
    [patch, toast]
  );

  // Web-service jobs live in the server's queue (lib/jobs): their progress is
  // the job row, read every few seconds. While one is waiting for a worker —
  // it paused at a time limit, or its worker died — the page asks the server
  // to continue it. A reload or another device picks it up the same way.
  const queueFollowing = useRef(new Set<string>());
  const kicking = useRef(new Set<string>());

  const followQueue = useCallback(
    (id: string) => {
      if (queueFollowing.current.has(id)) return;
      queueFollowing.current.add(id);
      const tick = async () => {
        let job: any = null;
        try {
          const r = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
          if (r.status === 404) {
            queueFollowing.current.delete(id);
            patch(id, (j) => ({ ...j, status: "error", log: [...j.log, "This run is gone."] }));
            return;
          }
          if (r.ok) job = (await r.json()).job;
        } catch {
          // Offline for a moment: try again on the next tick.
        }
        if (job) {
          const status: JobStatus =
            job.status === "done" ? "done" : job.status === "error" ? "error" : job.status === "cancelled" ? "aborted" : "running";
          const saves = (job.log as string[]).filter((l) => /^(Saved|Placed) /.test(l)).length;
          patch(id, (j) => ({
            ...j,
            log: job.log,
            tokens: job.tokens,
            status,
            saved: job.result ?? j.saved,
            saves,
            edit: j.kind === "sheet" ? { docKey: job.docKey ?? j.edit?.docKey ?? "", request: j.edit?.request ?? job.request ?? "" } : j.edit,
            lastActivity: Date.parse(job.updatedAt) || Date.now(),
          }));
          if (status !== "running") {
            queueFollowing.current.delete(id);
            const where = String(job.folder).replace(/-/g, " ");
            const noun = job.kind === "quiz" ? "quiz" : job.kind === "pictures" ? "pictures" : job.kind.startsWith("sheet") ? "cheatsheet" : "lesson";
            if (status === "done") {
              toast.success(noun === "pictures" ? `Pictures added in "${where}".` : noun === "cheatsheet" ? `Cheatsheet updated in "${where}".` : `Generated ${noun} in "${where}".`);
              setCompletedTick((n) => n + 1);
            } else if (status === "error") {
              toast.error(`The ${noun} run failed in "${where}" — see the log.`);
              if (saves) setCompletedTick((n) => n + 1);
            }
            return;
          }
          const stale = Date.now() - (Date.parse(job.updatedAt) || 0) > 100_000;
          if ((job.status === "queued" || stale) && !kicking.current.has(id)) {
            kicking.current.add(id);
            fetch(`/api/jobs/${id}/run`, { method: "POST" })
              .catch(() => {})
              .finally(() => kicking.current.delete(id));
          }
        }
        setTimeout(tick, 3000);
      };
      tick();
    },
    [patch, toast]
  );

  // Files a web-service job and follows it.
  const enqueue = useCallback(
    async (body: Record<string, unknown>, job: Omit<GenerateJob, "id" | "status" | "log" | "tokens" | "startedAt" | "lastActivity">) => {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Not started, so nothing will ever read what was uploaded for it.
        await discardUploads(Array.isArray(body.uploads) ? (body.uploads as Array<{ path: string }>) : []);
        throw new Error(data.error || `failed to start (HTTP ${res.status})`);
      }
      setJobs((prev) => [
        ...prev,
        { ...job, id: data.jobId, status: "running", log: [], tokens: { input: 0, output: 0 }, startedAt: Date.now(), lastActivity: Date.now(), queue: true },
      ]);
      followQueue(data.jobId);
      return data.jobId as string;
    },
    [followQueue]
  );

  // A reload drops the SSE reader but not the run behind it. Ask what is still
  // going — or finished but not yet saved — and re-attach, so a refresh
  // mid-generation doesn't orphan a job the user can no longer see. A "ready"
  // job's tail ends at once, and follow() saves it.
  //
  // This provider mounts above AppShell, so its own mount coincides with the
  // tree/tags/auth requests that draw the first screen. A job is running only
  // rarely, so this check loses nothing by waiting for the browser to be idle
  // first rather than competing with the requests the reader is actually
  // looking at — `requestIdleCallback` falls back to a same-tick `setTimeout`
  // where it doesn't exist (Safari).
  useEffect(() => {
    let cancelled = false;
    const recover = () => {
      if (cancelled) return;
      fetch("/api/generate")
        .then((r) => (r.ok ? r.json() : { jobs: [] }))
        .then((data) => {
          if (cancelled) return;
          const running = (data.jobs ?? []).filter(
            (j: any) => j.status === "running" || j.status === "ready"
          );
          if (!running.length) return;
          // Merged, not replaced: the queue's jobs may have arrived first.
          setJobs((prev) => [
            ...prev.filter((p) => !running.some((j: any) => j.id === p.id)),
            ...running.map((j: any) => ({
              id: j.id,
              folder: j.folder,
              kind: j.kind,
              sheet: j.sheet,
              edit: j.edit,
              step: j.step,
              status: "running" as JobStatus,
              // The tail replays the whole log from the beginning, so starting
              // empty is correct — it fills in immediately.
              log: [],
              tokens: j.tokens ?? { input: 0, output: 0 },
              startedAt: j.startedAt ?? Date.now(),
              lastActivity: Date.now(),
              service: j.service,
            })),
          ]);
          for (const j of running) follow(j.id);
        })
        .catch(() => {});
      fetch("/api/jobs", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { jobs: [] }))
        .then((data) => {
          if (cancelled) return;
          const going = (data.jobs ?? []).filter((j: any) => j.status === "queued" || j.status === "running");
          if (!going.length) return;
          setJobs((prev) => [
            ...prev,
            ...going
              .filter((j: any) => !prev.some((p) => p.id === j.id))
              .map((j: any) => ({
                id: j.id,
                folder: j.folder,
                kind: j.kind.startsWith("sheet") ? ("sheet" as const) : j.kind === "quiz" ? ("quiz" as const) : ("lect" as const),
                sheet: j.sheet,
                step: j.kind === "sheet-review" ? ("review" as const) : j.kind === "sheet-edit" ? ("edit" as const) : j.kind === "sheet-write" ? ("write" as const) : undefined,
                edit: j.kind.startsWith("sheet") ? { docKey: j.docKey ?? "", request: j.request ?? "" } : undefined,
                status: "running" as JobStatus,
                log: j.log ?? [],
                tokens: j.tokens ?? { input: 0, output: 0 },
                startedAt: Date.parse(j.createdAt) || Date.now(),
                lastActivity: Date.now(),
                service: isWebService(j.service) ? WEB_SERVICES[j.service as WebService].label : undefined,
                queue: true,
              })),
          ]);
          for (const j of going) followQueue(j.id);
        })
        .catch(() => {});
    };
    const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 0));
    const cancelIdle = window.cancelIdleCallback ?? clearTimeout;
    const handle = idle(recover);
    return () => {
      cancelled = true;
      cancelIdle(handle);
    };
  }, [follow, followQueue]);

  const start = useCallback<GenerateJobsValue["start"]>(
    async ({ file, folder, kind, lesson, web }) => {
      if (activeCount >= MAX_CONCURRENT_JOBS) {
        toast.error(`Already generating ${activeCount} files — wait for one to finish.`);
        return null;
      }
      if (web) {
        try {
          const uploads = await uploadForJob([file]);
          return await enqueue(
            { kind: lesson ? "pictures" : kind === "quiz" ? "quiz" : "lesson", folder, service: web.service, uploads, lesson },
            { folder, kind, service: web.label }
          );
        } catch (err: any) {
          toast.error(err.message);
          return null;
        }
      }
      try {
        const form = new FormData();
        form.set("file", file);
        form.set("folder", folder);
        form.set("kind", kind);
        if (lesson) form.set("lesson", lesson);
        const res = await fetch(lesson ? "/api/generate/images" : "/api/generate", { method: "POST", body: form });
        // An error page from in front of the route is not JSON; say what failed
        // instead of the browser's parse error.
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `failed to start (HTTP ${res.status})`);
        setJobs((prev) => [
          ...prev,
          {
            id: data.jobId,
            folder,
            kind,
            status: "running",
            log: [],
            tokens: { input: 0, output: 0 },
            startedAt: Date.now(),
            lastActivity: Date.now(),
            service: "Claude Code",
          },
        ]);
        follow(data.jobId);
        return data.jobId as string;
      } catch (err: any) {
        toast.error(err.message);
        return null;
      }
    },
    [activeCount, enqueue, follow, toast]
  );

  const startSheet = useCallback<GenerateJobsValue["startSheet"]>(
    async ({ folder, from, to, pages, columns, files, web }) => {
      if (activeCount >= MAX_CONCURRENT_JOBS) {
        toast.error(`Already running ${activeCount} jobs — wait for one to finish.`);
        return null;
      }
      if (web) {
        try {
          const uploads = await uploadForJob(files);
          return await enqueue(
            { kind: "sheet-new", folder, service: web.service, from, to, pages, columns, uploads },
            { folder, kind: "sheet", step: "write", edit: { docKey: "", request: "" }, service: web.label }
          );
        } catch (err: any) {
          toast.error(err.message);
          return null;
        }
      }
      try {
        const form = new FormData();
        form.set("folder", folder);
        form.set("from", String(from));
        form.set("to", String(to));
        form.set("pages", String(pages));
        if (columns) form.set("columns", String(columns));
        for (const f of files) form.append("files", f);
        const res = await fetch("/api/sheet", { method: "POST", body: form });
        // An error page from in front of the route is not JSON; say what failed
        // instead of the browser's parse error.
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `failed to start (HTTP ${res.status})`);
        setJobs((prev) => [
          ...prev,
          {
            id: data.jobId,
            folder,
            kind: "sheet",
            sheet: data.sheet,
            step: "write",
            status: "running",
            log: [],
            tokens: { input: 0, output: 0 },
            startedAt: Date.now(),
            lastActivity: Date.now(),
            service: "Claude Code",
          },
        ]);
        follow(data.jobId);
        return data.jobId as string;
      } catch (err: any) {
        toast.error(err.message);
        return null;
      }
    },
    [activeCount, enqueue, follow, toast]
  );

  const sheetStep = useCallback<GenerateJobsValue["sheetStep"]>(
    async ({ folder, id, action, body, request }) => {
      if (activeCount >= MAX_CONCURRENT_JOBS) {
        toast.error(`Already running ${activeCount} jobs — wait for one to finish.`);
        return null;
      }
      // A step goes to whoever the reader last chose to run with.
      const runner = preferredRunner();
      if (isWebService(runner)) {
        try {
          let extra: Record<string, unknown> = {};
          if (body instanceof FormData) {
            const files = body.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
            extra = {
              refs: JSON.parse(String(body.get("refs") ?? "[]")),
              note: String(body.get("note") ?? ""),
              uploads: await uploadForJob(files),
            };
          } else if (body) {
            extra = body;
          }
          return await enqueue(
            { kind: `sheet-${action}`, folder, service: runner, sheet: id, ...extra },
            {
              folder,
              kind: "sheet",
              step: action === "review" ? "review" : action === "continue" ? "write" : "edit",
              edit: { docKey: id, request: request ?? "" },
              service: WEB_SERVICES[runner].label,
            }
          );
        } catch (err: any) {
          toast.error(err.message);
          return null;
        }
      }
      try {
        const multipart = body instanceof FormData;
        const res = await fetch(
          `/api/sheets/${encodeURIComponent(folder)}/${encodeURIComponent(id)}/${action}`,
          {
            method: "POST",
            ...(multipart
              ? { body }
              : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "could not start it");
        setJobs((prev) => [
          ...prev,
          {
            id: data.jobId,
            folder,
            kind: "sheet",
            sheet: data.sheet,
            step: data.step,
            edit: { docKey: id, request: request ?? "" },
            status: "running",
            log: [],
            tokens: { input: 0, output: 0 },
            startedAt: Date.now(),
            lastActivity: Date.now(),
            service: "Claude Code",
          },
        ]);
        follow(data.jobId);
        return data.jobId as string;
      } catch (err: any) {
        toast.error(err.message);
        return null;
      }
    },
    [activeCount, enqueue, follow, toast]
  );

  const abort = useCallback((id: string) => {
    if (jobsRef.current.find((j) => j.id === id)?.queue) {
      fetch(`/api/jobs/${id}`, { method: "DELETE" }).catch(() => {});
      return;
    }
    // The status change comes back through the stream's `end` event, so this
    // only has to ask; guessing locally could disagree with the server.
    fetch(`/api/generate/${id}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const dismiss = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id || j.status === "running"));
  }, []);

  return (
    <Ctx.Provider
      value={{ jobs, activeCount, now, completedTick, start, startSheet, sheetStep, abort, dismiss }}
    >
      {children}
    </Ctx.Provider>
  );
}
