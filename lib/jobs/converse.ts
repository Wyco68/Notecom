// Ask → check → fix, one AI call per step. Between calls only the last reply
// and the fix request are kept on the job, so a step that times out or a
// worker that dies picks up at the same round. A reply cut short by the
// worker stopping (a time limit, a crash) is kept as it streams, and the next
// worker asks the model to continue it instead of starting again.

import type { Part, Turn } from "@/lib/ai/core";
import type { JobContext } from "./context";

export const MAX_FIXES = 2;

const MIN_PARTIAL = 1000;
const CONTINUE =
  "Your reply above was interrupted before it finished. Continue it from exactly where it stops: " +
  "no repeat of what is already written, no preamble, nothing before the next character.";

/**
 * The interrupted reply and its continuation as one. A model that restarts
 * a line or repeats the last few words is joined at the overlap.
 */
export function joinContinuation(partial: string, more: string): string {
  const next = more.replace(/^\s*```[a-z]*\n/i, "");
  for (let n = Math.min(400, partial.length, next.length); n >= 12; n--) {
    if (next.startsWith(partial.slice(-n))) return partial + next.slice(n);
  }
  return partial + next;
}

export type Check<T> = { ok: T } | { problems: string[] };

export type Outcome<T> =
  | { kind: "accepted"; value: T; reply: string }
  | { kind: "retry" }
  | { kind: "exhausted"; problems: string[]; reply: string }
  | { kind: "cut" };

export async function converse<T>(
  ctx: JobContext,
  slot: string,
  opts: {
    system: string;
    first: () => Promise<Part[]>;
    check: (reply: string) => Check<T>;
    fix: (problems: string[]) => string;
  }
): Promise<Outcome<T>> {
  const conv: { round?: number; reply?: string; fix?: string; partial?: string } = ctx.state[slot] ?? {};
  const round = conv.round ?? 0;
  const turns: Turn[] = [{ role: "user", parts: await opts.first() }];
  if (conv.reply && conv.fix) {
    turns.push({ role: "assistant", parts: [{ kind: "text", text: conv.reply }] }, { role: "user", parts: [{ kind: "text", text: conv.fix }] });
  }
  // Too short to be worth continuing: asked again from the start.
  const partial = (conv.partial?.length ?? 0) >= MIN_PARTIAL ? conv.partial! : "";
  if (partial) {
    turns.push({ role: "assistant", parts: [{ kind: "text", text: partial }] }, { role: "user", parts: [{ kind: "text", text: CONTINUE }] });
  }
  const result = await ctx.ask(opts.system, turns, (sofar) => {
    ctx.state[slot] = { ...(ctx.state[slot] ?? {}), partial: partial ? joinContinuation(partial, sofar) : sofar };
  });
  if (result.truncated) {
    delete ctx.state[slot];
    return { kind: "cut" };
  }
  const reply = partial ? joinContinuation(partial, result.text) : result.text;
  delete ctx.state[slot]?.partial;
  const checked = opts.check(reply);
  if ("ok" in checked) {
    delete ctx.state[slot];
    return { kind: "accepted", value: checked.ok, reply };
  }
  if (round >= MAX_FIXES) {
    delete ctx.state[slot];
    return { kind: "exhausted", problems: checked.problems, reply };
  }
  ctx.state[slot] = { round: round + 1, reply, fix: opts.fix(checked.problems) };
  return { kind: "retry" };
}

/** A labelled file attached to a message, in place of a path the CLI would read. */
export function fileBlock(name: string, content: string): Part {
  return { kind: "text", text: `FILE ${name}\n${content}\nEND FILE ${name}` };
}
