// Build the keyword search index for the GCS (Vercel) deployment.
//
// indexd (FTS5 + vector RAG) can't run on serverless, so the read-only
// GCS front-end serves search from this prebuilt file instead. Run it on
// the writer machine before syncing vault/ to the bucket:
//
//   npm run build:search-index
//   gcloud storage rsync -r ./vault gs://<bucket>/vault
//
// Output: vault/.search-index.json — one entry per lesson section (h2/h3),
// mirroring how indexd chunks lessons, so search hits still deep-link to
// the right heading in the viewer.

import { readdir, readFile, writeFile } from "fs/promises";
import path from "path";

const VAULT = path.join(process.cwd(), "vault");
const OUT = path.join(VAULT, ".search-index.json");

const stripTags = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#34;|&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

// index.json is either {lessons,quizzes,assignments} or a legacy bare array
// (lessons only) — mirror vaultd's loadIndexData normalization.
const normalizeIndex = (raw) =>
  Array.isArray(raw)
    ? { lessons: raw, quizzes: [], assignments: [] }
    : { lessons: raw.lessons ?? [], quizzes: raw.quizzes ?? [], assignments: raw.assignments ?? [] };

// Split a lesson's HTML into { title, sections:[{heading, headingIndex, text}] }.
// headingIndex is the running count of identical heading texts in the doc, so
// the viewer can scroll to the nth "How it Works" the same way search hits do.
function parse(html) {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = h1 ? stripTags(h1[1]) : "";

  const heads = [];
  const re = /<(h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    heads.push({ text: stripTags(m[2]), start: m.index, end: re.lastIndex });
  }

  const counts = {};
  const sections = heads.map((h, i) => {
    const bodyEnd = i + 1 < heads.length ? heads[i + 1].start : html.length;
    const text = stripTags(html.slice(h.end, bodyEnd));
    const headingIndex = counts[h.text] ?? 0;
    counts[h.text] = headingIndex + 1;
    return { heading: h.text, headingIndex, text };
  });
  return { title, sections };
}

const KINDS = { lessons: "lesson", quizzes: "quiz", assignments: "assignment" };

const entries = [];
const dirents = await readdir(VAULT, { withFileTypes: true });
for (const d of dirents) {
  if (!d.isDirectory() || d.name.startsWith(".")) continue;
  const folder = d.name;
  let idx;
  try {
    idx = normalizeIndex(JSON.parse(await readFile(path.join(VAULT, folder, "index.json"), "utf8")));
  } catch {
    continue;
  }
  for (const [arr, kind] of Object.entries(KINDS)) {
    for (const item of idx[arr] ?? []) {
      let html;
      try {
        html = await readFile(path.join(VAULT, folder, `${item.id}.html`), "utf8");
      } catch {
        continue;
      }
      const { title, sections } = parse(html);
      const docTitle = title || item.title;
      for (const s of sections) {
        entries.push({
          folder,
          id: item.id,
          kind,
          seq: item.seq,
          title: docTitle,
          heading: s.heading,
          headingIndex: s.headingIndex,
          text: s.text.slice(0, 600),
        });
      }
    }
  }
}

await writeFile(OUT, JSON.stringify({ generatedAt: Date.now(), entries }));
console.log(
  `Wrote ${entries.length} search entries to ${path.relative(process.cwd(), OUT)}`
);
