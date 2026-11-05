// Slide pictures added to a saved lesson, by a web service: /lect's Picture
// mode. The pictures are pulled out of the uploaded deck on the server, shown
// to the model as images, and placed by the model's JSON placements — the
// lesson's wording is never rewritten.

import { createHash } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { checkLesson } from "@/lib/generate/validate";
import { parsePlacements, placePictures } from "@/lib/generate/place";
import { savePictures } from "@/lib/generate/save";
import { picturesSystemPrompt } from "@/lib/generate/template";
import { extractSlideImages, IMAGE_EXT, type SlideImage } from "@/lib/generate/media";
import { blockPerLine, type Picture } from "@/lib/generate/runner";
import { sourceParts } from "@/lib/ai/source";
import type { Part } from "@/lib/ai/core";
import { loadDoc } from "@/lib/vault/store";
import { readUpload, type Upload } from "../queue";
import { converse, fileBlock } from "../converse";
import type { JobContext } from "../context";

// Pictures shown to the model per run: enough for a long deck's diagrams,
// bounded so a picture-heavy deck can't run up the reader's bill.
const MAX_OFFERED = 24;

async function offeredPictures(upload: Upload, lessonHtml: string) {
  const file = await readUpload(upload);
  const dir = path.join(tmpdir(), "notes-job-pictures", createHash("sha256").update(upload.path).digest("hex").slice(0, 16));
  await mkdir(dir, { recursive: true });
  const source = path.join(dir, upload.name.replace(/[^\w.-]/g, "_"));
  await writeFile(source, Buffer.from(await file.arrayBuffer()));
  try {
    const shown = new Set([...lessonHtml.matchAll(/\/api\/media\/[0-9a-f-]{36}\/([0-9a-f]{64})\./g)].map((m) => m[1]));
    const all = await extractSlideImages(source, path.join(dir, "media"));
    const images: Array<SlideImage & { data: Buffer }> = [];
    for (const img of all) {
      const data = await readFile(img.path);
      if (shown.has(createHash("sha256").update(data).digest("hex"))) continue;
      images.push({ ...img, data });
      if (images.length >= MAX_OFFERED) break;
    }
    return { file, images };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function picturesStep(ctx: JobContext): Promise<void> {
  const folder: string = ctx.job.params.folder;
  const docKey: string = ctx.job.params.docKey;
  const uploads: Upload[] = ctx.job.params.uploads ?? [];
  const lesson = await loadDoc(folder, docKey, "lesson");
  const { file, images } = await offeredPictures(uploads[0], lesson.html);
  const names = new Set(images.map((i) => i.name));

  if (!ctx.state.started) {
    ctx.state.started = true;
    ctx.say(
      images.length
        ? `Found ${images.length} slide picture(s) the lesson can use.`
        : /\.pdf$/i.test(uploads[0].name)
          ? // The hosted app has no PDF tools (poppler); a .pptx is read anywhere.
            "Found no pictures to add. If the PDF has some, upload the deck as .pptx instead — not every server can read pictures out of a PDF."
          : "The slides have no pictures to add."
    );
  }
  if (!images.length) {
    ctx.done({ id: docKey, title: lesson.title }, "Nothing to add — the lesson stays as it was.");
    return;
  }

  let placed = "";
  const outcome = await converse<number>(ctx, "place", {
    system: picturesSystemPrompt(),
    first: async () => {
      const slides = await sourceParts(file).catch(() => null);
      const parts: Part[] = [
        fileBlock("lesson.html", blockPerLine(lesson.html)),
        ...(slides?.parts.filter((p) => p.kind !== "image") ?? []),
      ];
      for (const img of images) {
        parts.push({ kind: "text", text: `Picture ${img.name} (slide ${img.slide}, ${img.width}×${img.height})` });
        parts.push({ kind: "image", data: img.data.toString("base64"), mime: img.mime });
      }
      parts.push({
        kind: "text",
        text:
          "Picture mode: add the slide pictures that teach to the saved lesson in lesson.html — do not rewrite it. " +
          "Follow the /lect command's Picture mode and its slide-picture rules exactly. Reply with only the JSON array of placements.",
      });
      return parts;
    },
    check: (reply) => {
      const parsed = parsePlacements(reply);
      if (!parsed) return { problems: ["reply with only the JSON array of placements"] };
      const { html, errors } = placePictures(lesson.html, parsed, names);
      if (errors.length) return { problems: errors };
      const problems = checkLesson(html, names);
      if (problems.length) return { problems };
      placed = html;
      return { ok: parsed.length };
    },
    fix: (problems) =>
      `The app couldn't apply those placements: ${problems.slice(0, 10).map((p) => p.slice(0, 200)).join("; ")}. ` +
      `Fix exactly these and reply with only the complete corrected JSON array of placements.`,
  });

  if (outcome.kind === "retry") {
    ctx.say(`Placements need fixing — asking ${ctx.label} again (${ctx.state.place.round} of 2).`);
    return;
  }
  if (outcome.kind !== "accepted") {
    ctx.fail(
      outcome.kind === "cut"
        ? "The reply was cut off at the model's output limit. The lesson stays as it was."
        : `The placements still don't fit after two fixes: ${outcome.problems.slice(0, 3).join("; ")}. The lesson stays as it was.`
    );
    return;
  }

  const used = new Map<string, Picture>();
  for (const img of images) {
    if (placed.includes(`src="${img.name}"`)) {
      used.set(img.name, { data: img.data, ext: IMAGE_EXT[img.mime], width: img.width, height: img.height });
    }
  }
  if (!used.size) {
    ctx.done({ id: docKey, title: lesson.title }, "No picture was worth adding — the lesson stays as it was.");
    return;
  }
  const saved = await savePictures(folder, docKey, placed, used);
  ctx.done(saved, `Placed ${used.size} picture(s) in "${saved.title}".`);
}
