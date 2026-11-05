// The worker: claims a job, runs its steps one AI call at a time, saving
// progress after each, until the job is finished or the time this request
// has is nearly used up — then lets go, and the next request picks it up.
//
// Every request that runs it carries the reader's own session (the job
// route's after(), or the page asking it to continue), so each step reads and
// saves as the reader, under RLS, exactly like the reader's own edits.

import { AiError } from "@/lib/ai/core";
import { SourceError } from "@/lib/ai/source";
import { resolveWritableFolderId } from "@/lib/vault/store";
import { claim, getJob, JobFailure, removeUploads, writeProgress, type JobRow } from "./queue";
import { badParams } from "./params";
import { explain, JobContext, LEASE_SECONDS, Stop } from "./context";
import { documentStep } from "./kinds/document";
import { picturesStep } from "./kinds/pictures";
import { sheetEditStep, sheetReviewStep, sheetWriteStep } from "./kinds/sheet";

const STEPS: Record<JobRow["kind"], (ctx: JobContext) => Promise<void>> = {
  lesson: documentStep,
  quiz: documentStep,
  pictures: picturesStep,
  "sheet-write": sheetWriteStep,
  "sheet-edit": sheetEditStep,
  "sheet-review": sheetReviewStep,
};

// A step is one AI call: start one only with room left for a long reply.
// Pausing costs little (the page continues the job within seconds), so a
// step gets at least this long; one that still runs over is continued from
// the reply so far (lib/jobs/converse.ts).
const ROOM_MS = 200_000;

const stopped = (err: unknown) => err instanceof Stop || (err instanceof AiError && err.kind === "aborted");

/** What the reader is told when a step throws: never a raw server message. */
function failure(err: unknown, label: string): string {
  if (err instanceof AiError) return explain(err, label);
  if (err instanceof JobFailure || err instanceof SourceError) return `Failed: ${err.message}.`;
  console.error("[jobs] step failed:", (err as Error)?.message);
  return "Failed on the server. Nothing more was saved — try again.";
}

/** The uploads a job read, removed once it has ended, however it ended. */
export async function endUploads(job: Pick<JobRow, "params">): Promise<void> {
  await removeUploads(job.params.uploads ?? []).catch(() => {});
}

/**
 * Works on job `id` until it ends or `deadline` (ms since epoch) is close.
 * "busy" when another worker holds it or it has already ended.
 */
export async function runJob(id: string, deadline: number): Promise<"finished" | "paused" | "busy"> {
  const job = await claim(id, LEASE_SECONDS);
  if (!job) {
    // The claim itself gives up on a job after five tries: its uploads go
    // then, as after any other ending.
    const ended = await getJob(id).catch(() => null);
    if (ended && ended.status !== "queued" && ended.status !== "running") await endUploads(ended);
    return "busy";
  }

  const ctx = new JobContext(job);
  try {
    // Checked on every claim, not once: the row is the only thing the worker
    // goes by, and the folder it names must be the writable folder the job
    // was filed against.
    if (badParams(job) || (await resolveWritableFolderId(job.params.folder)) !== job.folder_id) {
      ctx.fail("This run's request isn't valid, so nothing was done.");
      await ctx.flush();
    }
    while (ctx.status === "running") {
      if (Date.now() > deadline - ROOM_MS) {
        // Hand the job back; the next request continues it at once.
        await writeProgress(job, {
          log: ctx.log,
          state: ctx.state,
          status: "queued",
          result: ctx.result,
          tokens_in: ctx.tokens.input,
          tokens_out: ctx.tokens.output,
        });
        return "paused";
      }
      let stepDone = false;
      try {
        await STEPS[job.kind](ctx);
        stepDone = true;
      } catch (err) {
        if (stopped(err)) throw err;
        ctx.fail(failure(err, ctx.label));
      }
      await ctx.flush(stepDone);
    }
  } catch (err) {
    // Cancelled by the reader (the flush found it so, or the call was cut).
    if (!stopped(err)) throw err;
  }
  await endUploads(job);
  return "finished";
}
