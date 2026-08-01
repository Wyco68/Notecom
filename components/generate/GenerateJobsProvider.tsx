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
// the log keeps filling and the tree still refreshes when the file lands.
//
// Nothing here is persisted. A job belongs to one server process and one page
// session; on reload the provider re-attaches to whatever is still running by
// asking `/api/generate`, which is the difference between "kept running" and
// "kept running, and you can still see it".

export type JobStatus = "running" | "done" | "error" | "aborted";

export interface GenerateJob {
  id: string;
  folder: string;
  kind: "lect" | "quiz";
  status: JobStatus;
  log: string[];
  tokens: { input: number; output: number };
  startedAt: number;
  /** ms timestamp of the last streamed line — drives the "still working" hint. */
  lastActivity: number;
  /** the run failed for lack of a CLI session; the UI offers sign-in */
  needsAuth?: boolean;
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
  start: (input: { file: File; folder: string; kind: "lect" | "quiz" }) => Promise<string | null>;
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

  // Jobs already being followed, so a re-attach can't open a second reader on
  // the same stream (which would duplicate every log line).
  const following = useRef(new Set<string>());

  const follow = useCallback(
    async (id: string) => {
      if (following.current.has(id)) return;
      following.current.add(id);
      let status: JobStatus = "error";
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

      patch(id, (j) => ({ ...j, status, needsAuth }));
      // Announce the outcome here rather than in the modal: by now the reader
      // may well have closed the modal and moved on, and a finished run they
      // are not looking at is exactly the one worth announcing.
      setJobs((prev) => {
        const job = prev.find((j) => j.id === id);
        const where = job ? job.folder.replace(/-/g, " ") : "the folder";
        const noun = job?.kind === "quiz" ? "quiz" : "lesson";
        if (status === "done") toast.success(`Generated ${noun} in "${where}".`);
        else if (status === "error") toast.error(`Generation failed in "${where}" — see the log.`);
        return prev;
      });
      if (status === "done") setCompletedTick((n) => n + 1);
    },
    [patch, toast]
  );

  // A reload drops the SSE reader but not the run behind it. Ask what is still
  // going and re-attach, so a refresh mid-generation doesn't orphan a job the
  // user can no longer see.
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
          const running = (data.jobs ?? []).filter((j: any) => j.status === "running");
          if (!running.length) return;
          setJobs(
            running.map((j: any) => ({
              id: j.id,
              folder: j.folder,
              kind: j.kind,
              status: "running" as JobStatus,
              // The tail replays the whole log from the beginning, so starting
              // empty is correct — it fills in immediately.
              log: [],
              tokens: j.tokens ?? { input: 0, output: 0 },
              startedAt: j.startedAt ?? Date.now(),
              lastActivity: Date.now(),
            }))
          );
          for (const j of running) follow(j.id);
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
  }, [follow]);

  const start = useCallback<GenerateJobsValue["start"]>(
    async ({ file, folder, kind }) => {
      if (activeCount >= MAX_CONCURRENT_JOBS) {
        toast.error(`Already generating ${activeCount} files — wait for one to finish.`);
        return null;
      }
      try {
        const form = new FormData();
        form.set("file", file);
        form.set("folder", folder);
        form.set("kind", kind);
        const res = await fetch("/api/generate", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "failed to start");
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
          },
        ]);
        follow(data.jobId);
        return data.jobId as string;
      } catch (err: any) {
        toast.error(err.message);
        return null;
      }
    },
    [activeCount, follow, toast]
  );

  const abort = useCallback((id: string) => {
    // The status change comes back through the stream's `end` event, so this
    // only has to ask; guessing locally could disagree with the server.
    fetch(`/api/generate/${id}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const dismiss = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id || j.status === "running"));
  }, []);

  return (
    <Ctx.Provider
      value={{ jobs, activeCount, now, completedTick, start, abort, dismiss }}
    >
      {children}
    </Ctx.Provider>
  );
}
