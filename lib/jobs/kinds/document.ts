// A lesson or quiz from one upload, written by a web service.

import { checkLesson, checkQuiz, extractHtml, titleOf } from "@/lib/generate/validate";
import { saveGenerated } from "@/lib/generate/save";
import { systemPrompt } from "@/lib/generate/template";
import { sourceParts, SourceError } from "@/lib/ai/source";
import { listFolderDocs } from "@/lib/vault/store";
import { readUpload, type Upload } from "../queue";
import { converse } from "../converse";
import type { JobContext } from "../context";

export async function documentStep(ctx: JobContext): Promise<void> {
  const kind = ctx.job.kind === "quiz" ? "quiz" : "lect";
  const noun = kind === "quiz" ? "quiz" : "lesson";
  const folder: string = ctx.job.params.folder;
  const uploads: Upload[] = ctx.job.params.uploads ?? [];

  // A save that went through before the worker could record it: find the
  // document instead of writing it twice.
  if (ctx.state.saving) {
    const docs = await listFolderDocs(folder);
    const found = (kind === "quiz" ? docs.quizzes : docs.lessons).find((d) => d.title === ctx.state.saving);
    if (found) {
      ctx.done({ id: found.id, title: found.title }, `Saved ${noun} "${found.title}" to ${folder}.`);
      return;
    }
  }

  if (!ctx.state.started) {
    ctx.state.started = true;
    ctx.say(`Writing the ${noun}…`);
  }

  const outcome = await converse<string>(ctx, "write", {
    system: systemPrompt(kind),
    first: async () => {
      let source;
      try {
        source = await sourceParts(await readUpload(uploads[0]));
      } catch (err) {
        throw new SourceError(err instanceof Error ? err.message : "the upload can't be read");
      }
      return [
        ...source.parts,
        { kind: "text", text: `Write the ${noun} from this source. Reply with only its complete HTML, starting at the <h1>.` },
      ];
    },
    check: (reply) => {
      const html = extractHtml(reply);
      if (!html) return { problems: [`no ${noun} came back — reply with the complete HTML, starting at the <h1>`] };
      const problems = kind === "quiz" ? checkQuiz(html) : checkLesson(html);
      return problems.length ? { problems } : { ok: html };
    },
    fix: (problems) =>
      `The app rejected that ${noun} against its output contract: ${problems.slice(0, 10).map((p) => p.slice(0, 200)).join("; ")}. ` +
      `Fix exactly these problems without changing anything else, and reply with only the complete corrected HTML, starting at the <h1>.`,
  });

  if (outcome.kind === "retry") {
    ctx.say(`Contract check failed — asking ${ctx.label} to fix it (${ctx.state.write.round} of 2).`);
    return;
  }
  if (outcome.kind === "cut") {
    ctx.fail("The reply hit the model's output limit and was cut off. Nothing was saved. Try a model with a larger output limit.");
    return;
  }
  if (outcome.kind === "exhausted") {
    ctx.fail(`Still failing the contract check after two fixes: ${outcome.problems.slice(0, 5).join("; ")}. Nothing was saved.`);
    return;
  }

  ctx.say(`The ${noun} passed the contract check — saving it.`);
  ctx.state.saving = titleOf(outcome.value) || "Untitled";
  await ctx.flush();
  const saved = await saveGenerated(folder, kind, outcome.value);
  ctx.done(saved, `Saved ${noun} "${saved.title}" to ${folder}.`);
}
