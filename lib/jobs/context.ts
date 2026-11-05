// What a job step works with: the row's state and log in memory, the
// reader's decrypted key, and one way to ask the AI service. Progress goes
// back to the row after every step and, while a call streams, every few
// seconds — which is also the lease's heartbeat.

import { chat, AiError, type Turn } from "@/lib/ai/chat";
import { WEB_SERVICES } from "@/lib/ai/services";
import { useKey, VaultError } from "@/lib/ai/vault";
import { writeProgress, type JobRow, type JobStatus } from "./queue";

export const LEASE_SECONDS = 90;
const HEARTBEAT_MS = 15_000;

export class Stop extends Error {}

export class JobContext {
  readonly job: JobRow;
  readonly label: string;
  log: string[];
  state: Record<string, any>;
  status: JobStatus = "running";
  result: JobRow["result"];
  tokens: { input: number; output: number };
  private key: string | null = null;
  private dirty = false;
  private readonly abort = new AbortController();

  constructor(job: JobRow) {
    this.job = job;
    this.label = WEB_SERVICES[job.service].label;
    this.log = [...job.log];
    this.state = { ...job.state };
    this.result = job.result;
    this.tokens = { input: job.tokens_in, output: job.tokens_out };
  }

  say(...lines: string[]) {
    this.log.push(...lines);
    this.dirty = true;
  }

  done(result: { id: string; title: string }, line: string) {
    this.result = result;
    this.status = "done";
    this.say(line, "Finished.");
  }

  fail(line: string) {
    this.status = "error";
    this.say(line);
  }

  /**
   * Saves progress (and renews the lease). Throws Stop when the reader
   * cancelled. `stepDone`: a step just finished, so the count of tries that
   * ran out of time starts again (notes_claim_job gives up at five).
   */
  async flush(stepDone = false): Promise<void> {
    const ok = await writeProgress(
      this.job,
      {
        log: this.log,
        state: this.state,
        status: this.status,
        result: this.result,
        tokens_in: this.tokens.input,
        tokens_out: this.tokens.output,
      },
      { leaseSeconds: LEASE_SECONDS, stepDone }
    );
    this.dirty = false;
    if (!ok) {
      this.abort.abort();
      throw new Stop();
    }
  }

  /**
   * One AI call with the reader's key, streamed, with a heartbeat while it
   * runs. `keep` is given the reply so far just before each heartbeat saves
   * the state, so a worker stopped mid-reply can leave it for the next one to
   * continue from (lib/jobs/converse.ts).
   */
  async ask(system: string, turns: Turn[], keep?: (sofar: string) => void) {
    if (!this.key) {
      let saved;
      try {
        saved = await useKey(this.job.owner_id, this.job.service);
      } catch (err) {
        throw new AiError("auth", err instanceof VaultError ? err.message : "the saved key can't be read");
      }
      if (!saved) throw new AiError("auth", `no ${this.label} key is saved — add it in the Generate dialog`);
      this.key = saved.key;
    }
    const before = { ...this.tokens };
    let sofar = "";
    const beat = setInterval(() => {
      this.tokens = { input: before.input, output: before.output + Math.round(sofar.length / 4) };
      if (keep && sofar) keep(sofar);
      this.flush().catch(() => this.abort.abort());
    }, HEARTBEAT_MS);
    try {
      const result = await chat({
        service: this.job.service,
        key: this.key,
        model: this.job.model,
        system,
        turns,
        signal: this.abort.signal,
        onProgress: (_, text) => {
          sofar = text;
        },
      });
      this.tokens = { input: before.input + result.usage.input, output: before.output + result.usage.output };
      this.dirty = true;
      return result;
    } finally {
      clearInterval(beat);
    }
  }

  get pending() {
    return this.dirty;
  }
}

/** A failure the reader can act on, in their words. */
export function explain(err: unknown, label: string): string {
  if (!(err instanceof AiError)) return `${label} failed. Nothing was saved.`;
  const detail = err.message ? ` (${err.message})` : "";
  switch (err.kind) {
    case "auth":
      return `${label} didn't accept the key${detail}. Check it in the Generate dialog.`;
    case "rate":
      return `${label} says the rate limit or quota is used up. Wait a bit, then try again.${detail}`;
    case "bad-request":
      return `${label} refused the request${detail}.`;
    case "refused":
      return "The model declined to write this one.";
    case "network":
      return `Couldn't reach ${label}. Try again.`;
    case "aborted":
      return "Stopped.";
    default:
      return `${label} failed${detail}.`;
  }
}
