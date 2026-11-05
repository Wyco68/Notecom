// Cheatsheet steps written by a web service: write (one chapter per step),
// edit (the whole sheet once), review (one chapter per step). The prompts,
// checks and saved meta are the CLI's (lib/generate/sheet.ts); what differs is
// that the files are attached to the message instead of named by path, and
// that each step saves straight away — the worker already holds the reader's
// session, so there is no "ready, waiting for the client" stage.

import { readFile, rm } from "fs/promises";
import path from "path";
import { checkSheet, extractSheet, sheetMarkupIssues } from "@/lib/generate/validate";
import { saveSheetVersion } from "@/lib/generate/save";
import { sheetSystemPrompt } from "@/lib/generate/template";
import { changedSections, paperLine, sectionsOf, sheetChecks, sheetNote, withSection } from "@/lib/generate/sheet";
import { blockPerLine } from "@/lib/generate/runner";
import { LAYOUTS, reviewOf, visibleChars, type SheetMessage, type SheetSpec, type SourceRef } from "@/lib/sheet/layout";
import { plainText, sourceIssues } from "@/lib/sheet/sources";
import { writeSheetInputs } from "@/lib/sheet/inputs";
import { sourceParts } from "@/lib/ai/source";
import type { Part } from "@/lib/ai/core";
import { loadDoc } from "@/lib/vault/store";
import { readUpload, type Upload } from "../queue";
import { converse, fileBlock, type Check } from "../converse";
import type { JobContext } from "../context";

interface Sources {
  chapters: Array<{ seq: number; path: string; name: string; raw: string; text: string }>;
  docs: Array<{ ref: SourceRef; path: string; name: string; raw: string; text: string }>;
  uploads: string[];
  uploadParts: Part[];
  cleanup: () => Promise<void>;
}

async function loadSources(folder: string, spec: SheetSpec, uploads: Upload[]): Promise<Sources> {
  const inputs = await writeSheetInputs(folder, spec.from, spec.to, spec.extra ?? []);
  if (!inputs) throw new Error("the sheet's lessons are no longer in the folder");
  const read = async (p: string) => {
    const raw = await readFile(p, "utf8");
    return { path: p, name: path.basename(p), raw, text: plainText(raw) };
  };
  const chapters = await Promise.all(inputs.chapters.map(async (c) => ({ seq: c.seq, ...(await read(c.path)) })));
  const docs = await Promise.all(inputs.docs.map(async (d) => ({ ref: d.ref, ...(await read(d.path)) })));
  const uploadParts: Part[] = [];
  for (const u of uploads) {
    const { parts } = await sourceParts(await readUpload(u));
    uploadParts.push({ kind: "text", text: `Uploaded source "${u.name}":` }, ...parts);
  }
  return {
    chapters,
    docs,
    uploads: uploads.map((u) => u.name),
    uploadParts,
    cleanup: () => rm(inputs.dir, { recursive: true, force: true }).catch(() => {}),
  };
}

function sourcesLine(src: Sources, only?: number): string {
  const more = [...src.docs.map((d) => `${d.name} (${d.ref.kind}: ${d.ref.title})`), ...src.uploads.map((u) => `the uploaded "${u}"`)];
  return (
    (more.length ? `Other sources: ${more.join(", ")}` + (only ? `; use only what belongs to chapter ${only}. ` : `. `) : "") +
    `Ground every fact strictly in these sources; if one cannot be read, stop and say so instead of guessing. `
  );
}

function sourceBlocks(src: Sources, chapters = src.chapters): Part[] {
  return [
    ...chapters.map((c) => fileBlock(c.name, c.raw)),
    ...src.docs.map((d) => fileBlock(d.name, d.raw)),
    ...src.uploadParts,
  ];
}

function sheetCheck(check: (html: string) => string[]): (reply: string) => Check<{ html: string; note?: string }> {
  return (reply) => {
    const html = extractSheet(reply);
    if (!html) return { problems: ["no cheatsheet came back — reply with one NOTE: line and the fragment, starting at the first <h2>"] };
    const open = check(html);
    return open.length ? { problems: open } : { ok: { html, note: sheetNote(reply) } };
  };
}

const FIX = (problems: string[]) =>
  `The app found these problems: ${problems.slice(0, 12).map((v) => v.slice(0, 240)).join("; ")}. ` +
  `Fix exactly these, change nothing else, and reply with one NOTE: line and the complete corrected fragment, starting at the first <h2>.`;

/** A reply that never passed every check may still be saved — if its markup is safe. */
function settle(ctx: JobContext, outcome: Awaited<ReturnType<typeof converse<{ html: string; note?: string }>>>) {
  if (outcome.kind === "accepted") return { html: outcome.value.html, note: outcome.value.note, open: [] as string[] };
  if (outcome.kind === "exhausted") {
    const html = extractSheet(outcome.reply);
    if (!html || sheetMarkupIssues(html).length) {
      ctx.fail("The markup still breaks the allowlist after two fixes, so nothing of this part is saved.");
      return null;
    }
    ctx.say(`Saving it with ${outcome.problems.length} open check(s) — they are listed with the sheet.`);
    return { html, note: sheetNote(outcome.reply), open: outcome.problems };
  }
  if (outcome.kind === "cut") ctx.fail("The reply hit the model's output limit and was cut off. Try a model with a larger output limit.");
  return null;
}

// --- write -----------------------------------------------------------------------

export async function sheetWriteStep(ctx: JobContext): Promise<void> {
  const folder: string = ctx.job.params.folder;
  const spec: SheetSpec = ctx.job.params.spec;
  const order: number[] = ctx.job.params.order;
  const uploads: Upload[] = ctx.job.params.uploads ?? [];
  const i: number = ctx.state.i ?? 0;
  const docKey: string | undefined = ctx.state.docKey ?? ctx.job.params.docKey;
  const seq = order[i];

  const src = await loadSources(folder, spec, uploads);
  try {
    const ch = src.chapters.find((c) => c.seq === seq);
    if (!ch) {
      ctx.say(`Chapter ${seq} is no longer in the folder — skipped.`);
      ctx.state.i = i + 1;
      if (ctx.state.i >= order.length) await finishWrite(ctx, folder, docKey, uploads);
      return;
    }
    if (ctx.state.announced !== i) {
      ctx.state.announced = i;
      ctx.say(`Writing chapter ${seq} (${i + 1} of ${order.length}).`);
    }
    const L = LAYOUTS[spec.layout];
    const totalText = src.chapters.reduce((n, c) => n + c.text.length, 0) || 1;
    const budget = spec.pages ? Math.round((L.budget * spec.pages * ch.text.length) / totalText) : undefined;

    const outcome = await converse(ctx, "write", {
      system: sheetSystemPrompt(),
      first: async () => [
        ...sourceBlocks(src, [ch]),
        {
          kind: "text",
          text:
            `/sheet Chapter mode. This is one part of a cheatsheet covering chapters ${spec.from} to ${spec.to}; the other chapters are written separately. ` +
            `Write only the section for chapter ${seq}, from its chapter file ${ch.name}. ` +
            sourcesLine(src, seq) +
            paperLine(spec, budget) +
            `Reply with one line starting "NOTE:" that tells the reader in plain words what this chapter covers or had to leave out, then the section, starting at <h2>${seq}. …</h2>, with no other <h2>.`,
        },
      ],
      check: sheetCheck((html) => {
        const issues = [
          ...checkSheet(html, { from: seq, to: seq }, [ch.text, ...src.docs.map((d) => d.text)].join(" ")),
          ...sourceIssues(html, [{ seq, text: ch.text }], src.uploads.length > 0, src.docs.map((d) => d.text)).hard,
        ];
        if (budget) {
          const chars = visibleChars(html);
          if (chars > budget * 1.3) {
            issues.push(`too long for its share: about ${chars} visible characters, room for about ${budget}; cut about ${Math.ceil((1 - budget / chars) * 100)} percent`);
          }
        }
        return issues;
      }),
      fix: FIX,
    });
    if (outcome.kind === "retry") {
      ctx.say(`Checks failed — asking ${ctx.label} to fix it (round ${ctx.state.write.round + 1} of 3).`);
      return;
    }
    const part = settle(ctx, outcome);
    if (!part) {
      ctx.say(i > 0 || docKey ? `Stopped at chapter ${seq}. What was written before it is saved — use Continue writing on the sheet.` : `Stopped at chapter ${seq}; nothing was saved yet.`);
      return;
    }

    const current = docKey ? (await loadDoc(folder, docKey, "sheet")).html : "";
    const html = withSection(current, seq, part.html);
    const rest = order.slice(i + 1);
    const last = rest.length === 0;
    const notes: string[] = [...(ctx.state.notes ?? []), ...(part.note ? [`Chapter ${seq}: ${part.note}`] : [])];
    const checksOn = { chapters: src.chapters, docs: src.docs, uploads: src.uploads };
    const saved = await saveSheetVersion(folder, docKey, html, spec, (m) => {
      const review = reviewOf(m);
      return {
        ...m,
        spec,
        pending: rest,
        checks: sheetChecks(spec, checksOn, html, rest),
        review: { reviewed: review.reviewed.filter((n) => n !== seq), issues: { ...review.issues, [seq]: [] } },
        messages: last
          ? [
              ...m.messages,
              { role: "assistant", text: notes.length ? notes.join("\n") : `Wrote chapters ${spec.from} to ${spec.to}.`, at: new Date().toISOString() },
            ]
          : m.messages,
      };
    });
    ctx.state.docKey = saved.id;
    ctx.state.notes = notes;
    ctx.state.i = i + 1;
    ctx.result = saved;
    ctx.say(`Saved chapter ${seq}${rest.length ? `; ${rest.length} to go` : ""}.`);
    if (last) await finishWrite(ctx, folder, saved.id, uploads, saved.title);
  } finally {
    await src.cleanup();
  }
}

async function finishWrite(ctx: JobContext, folder: string, docKey: string | undefined, uploads: Upload[], title?: string) {
  if (!docKey) {
    ctx.fail("No chapter could be written; nothing was saved.");
    return;
  }
  ctx.done({ id: docKey, title: title ?? ctx.result?.title ?? "Cheatsheet" }, `Cheatsheet written in "${folder}".`);
}

// --- edit --------------------------------------------------------------------------

export async function sheetEditStep(ctx: JobContext): Promise<void> {
  const folder: string = ctx.job.params.folder;
  const docKey: string = ctx.job.params.docKey;
  const request: string = ctx.job.params.request;
  const history: SheetMessage[] = ctx.job.params.history ?? [];
  const addRefs: SourceRef[] = ctx.job.params.addRefs ?? [];
  const uploads: Upload[] = ctx.job.params.uploads ?? [];
  const stored = await loadDoc(folder, docKey, "sheet");
  const spec: SheetSpec = { ...ctx.job.params.spec, extra: [...(ctx.job.params.spec.extra ?? []), ...addRefs.filter((r) => !(ctx.job.params.spec.extra ?? []).some((e: SourceRef) => e.kind === r.kind && e.id === r.id))] };
  const before: string = ctx.state.before ?? stored.html;
  ctx.state.before = before;

  const src = await loadSources(folder, spec, uploads);
  try {
    if (!ctx.state.started) {
      ctx.state.started = true;
      ctx.say("Editing the cheatsheet…");
    }
    const L = LAYOUTS[spec.layout];
    const checksOn = { chapters: src.chapters, docs: src.docs, uploads: src.uploads };
    const outcome = await converse(ctx, "edit", {
      system: sheetSystemPrompt(),
      first: async () => [
        fileBlock("current-sheet.html", blockPerLine(before)),
        fileBlock("request.txt", request),
        fileBlock("conversation.txt", history.slice(-12).map((m) => `${m.role === "user" ? "Reader" : "You"}: ${m.text}`).join("\n\n") || "(none)"),
        ...sourceBlocks(src),
        {
          kind: "text",
          text:
            `/sheet Edit mode. The current cheatsheet for chapters ${spec.from} to ${spec.to} is current-sheet.html. ` +
            `The reader's request is request.txt, and the conversation so far is conversation.txt. ` +
            `Chapter files, in order: ${src.chapters.map((c) => c.name).join(", ")}. ` +
            sourcesLine(src) +
            paperLine(spec, spec.pages ? L.budget * spec.pages : undefined) +
            `Change what the request asks and keep everything else; every rule of the cheatsheet guidelines still applies, and nothing may come from outside the sources. ` +
            `If the request asks for something the sources do not support, leave that part alone and say so. ` +
            `Reply with one line starting "NOTE:" that tells the reader in plain words what you changed, then the complete fragment, starting at the first <h2>.`,
        },
      ],
      check: sheetCheck((html) => sheetChecks(spec, checksOn, html)),
      fix: FIX,
    });
    if (outcome.kind === "retry") {
      ctx.say(`Checks failed — asking ${ctx.label} to fix it (round ${ctx.state.edit.round + 1} of 3).`);
      return;
    }
    const result = settle(ctx, outcome);
    if (!result) return;

    const changed = changedSections(before, result.html);
    const saved = await saveSheetVersion(folder, docKey, result.html, spec, (m) => {
      const review = reviewOf(m);
      const extra = [...(m.spec.extra ?? [])];
      for (const r of addRefs) if (!extra.some((e) => e.kind === r.kind && e.id === r.id)) extra.push(r);
      return {
        ...m,
        spec: { ...m.spec, extra },
        checks: result.open,
        review: {
          reviewed: review.reviewed.filter((n) => !changed.includes(n)),
          issues: Object.fromEntries(Object.entries(review.issues).filter(([k]) => !changed.includes(Number(k)))),
        },
        messages: [
          ...m.messages,
          { role: "user", text: request, at: ctx.job.created_at },
          { role: "assistant", text: result.note || "Done.", at: new Date().toISOString() },
        ],
      };
    });
    ctx.done(saved, `Saved the change (${changed.length ? `chapter(s) ${changed.join(", ")}` : "no section changed"}).`);
  } finally {
    await src.cleanup();
  }
}

// --- review --------------------------------------------------------------------------

export async function sheetReviewStep(ctx: JobContext): Promise<void> {
  const folder: string = ctx.job.params.folder;
  const docKey: string = ctx.job.params.docKey;
  const spec: SheetSpec = ctx.job.params.spec;
  const order: number[] = ctx.job.params.order;
  const i: number = ctx.state.i ?? 0;
  const seq = order[i];
  const stored = await loadDoc(folder, docKey, "sheet");
  const section = sectionsOf(stored.html).get(seq);

  const src = await loadSources(folder, spec, []);
  try {
    const ch = src.chapters.find((c) => c.seq === seq);
    let issues: string[];
    if (!ch) issues = [`missing: chapter ${seq}'s lesson is no longer in the folder, so it can't be checked`];
    else if (!section) issues = [`missing: the sheet has no section for chapter ${seq}`];
    else {
      ctx.say(`Reviewing chapter ${seq} (${i + 1} of ${order.length}).`);
      const unverified = sourceIssues(section, [], true, [ch.raw, ...src.docs.map((d) => d.raw)].map(plainText)).unverified;
      const result = await ctx.ask(sheetSystemPrompt(), [
        {
          role: "user",
          parts: [
            fileBlock(`review-ch${seq}.html`, blockPerLine(section)),
            fileBlock(ch.name, ch.raw),
            ...src.docs.map((d) => fileBlock(d.name, d.raw)),
            {
              kind: "text",
              text:
                `/sheet Review mode. Review the section for chapter ${seq} in review-ch${seq}.html. Its sources are the chapter file ${ch.name}` +
                (src.docs.length ? ` and ${src.docs.map((d) => d.name).join(", ")} (use only what belongs to chapter ${seq})` : "") +
                `. ` +
                (unverified.length ? `These numbers in the section are not in the sources; check each: ${unverified.slice(0, 30).join(", ")}. ` : "") +
                `Follow the review section of the /sheet command. Reply with only a JSON object and nothing else, of the form {"issues":[{"kind":"wrong|unsupported|missing|unclear","where":"a short exact quote from the section","fix":"what the sources say"}]}. An empty list means the section is correct and complete.`,
            },
          ],
        },
      ]);
      const parsed = parseIssues(result.text);
      if (!parsed) {
        if (!ctx.state.retried) {
          ctx.state.retried = true;
          ctx.say("The review answered in a shape that can't be read — asking again.");
          return;
        }
        ctx.fail(`The review stopped at chapter ${seq}.${i > 0 ? " The chapters before it are saved — run the review again to continue." : ""}`);
        return;
      }
      ctx.state.retried = false;
      issues = parsed;
    }

    const total = (ctx.state.total ?? 0) + issues.length;
    const last = i === order.length - 1;
    ctx.say(`Chapter ${seq}: ${issues.length ? `${issues.length} finding(s): ${issues.join("; ")}` : "nothing to fix"}.`);
    const saved = await saveSheetVersion(folder, docKey, null, spec, (m) => {
      const review = reviewOf(m);
      return {
        ...m,
        review: {
          reviewed: [...new Set([...review.reviewed, seq])].sort((a, b) => a - b),
          issues: { ...review.issues, [seq]: issues },
        },
        messages: last
          ? [
              ...m.messages,
              {
                role: "assistant",
                text: total
                  ? `Reviewed ${order.length} chapter(s) against the sources: ${total} finding(s), listed with the checks.`
                  : `Reviewed ${order.length} chapter(s) against the sources: nothing to fix.`,
                at: new Date().toISOString(),
              },
            ]
          : m.messages,
      };
    });
    ctx.state.i = i + 1;
    ctx.state.total = total;
    ctx.result = saved;
    if (last) ctx.done(saved, "Review finished — findings are with the sheet.");
  } finally {
    await src.cleanup();
  }
}

function parseIssues(reply: string): string[] | null {
  const a = reply.indexOf("{");
  const b = reply.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try {
    const parsed = JSON.parse(reply.slice(a, b + 1));
    if (!Array.isArray(parsed?.issues)) return null;
    return parsed.issues
      .filter((x: any) => x && typeof x === "object")
      .map((x: any) => `${String(x.kind ?? "issue")}: "${String(x.where ?? "").slice(0, 160)}" → ${String(x.fix ?? "").slice(0, 300)}`);
  } catch {
    return null;
  }
}
