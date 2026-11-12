// Produces parity.json: what the app's own TypeScript says about a set of
// lessons, quizzes and replies — the contract check, the extracted HTML and
// title, the search chunks, the document slug — plus a key encrypted the way
// lib/ai/vault.ts does. The Go tests (internal/contract, internal/search,
// internal/vault) replay it, so the two implementations can't drift apart
// unnoticed.
//
//   node tools/generator/testdata/parity.mjs
//
// Run it again after changing lib/generate/validate.ts,
// lib/search/chunker.ts or lib/vault/slug.ts, and commit the result.

import { createCipheriv, hkdfSync } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

// The TypeScript sources, copied with their "@/" imports made relative so
// Node can load them with its built-in type stripping.
const tmp = mkdtempSync(path.join(tmpdir(), "notecom-parity-"));
const copy = (from, to) => {
  const text = readFileSync(path.join(repo, from), "utf8").replace(/from "@\/lib\/vault\/media-src"/g, 'from "./media-src.ts"');
  writeFileSync(path.join(tmp, to), text);
  return pathToFileURL(path.join(tmp, to)).href;
};
copy("lib/vault/media-src.ts", "media-src.ts");
const validate = await import(copy("lib/generate/validate.ts", "validate.ts"));
const chunker = await import(copy("lib/search/chunker.ts", "chunker.ts"));
const { slugify } = await import(copy("lib/vault/slug.ts", "slug.ts"));

const MEDIA = "/api/media/0d6f2a8e-4c1b-4f7e-9a3d-2b5c8e1f0a11/" + "ab".repeat(32) + ".png";

const fixtures = {
  "lesson-valid": `<h1>Routing Basics &amp; Tables</h1>
<p>A <strong>router</strong> forwards <strong>packets</strong> between networks.</p>
<h2>Concept: Routing Table</h2>
<p>Each entry maps a <code>prefix</code> to a next hop. The router picks the longest match. This is called <strong>longest prefix match</strong>.</p>
<blockquote><strong>Key Idea:</strong> the most specific route wins.</blockquote>
<h3>How it Works</h3>
<ul><li>Look up the destination.</li><li>Pick the longest prefix.</li></ul>
<table><thead><tr><th>Prefix</th><th>Next hop</th></tr></thead><tbody><tr><td>10.0.0.0/8</td><td>R1</td></tr></tbody></table>
<h3>How it Works</h3>
<pre><code>show ip route</code></pre>
<div class="mermaid">graph LR; A--&gt;B</div>
<h2>Concept: Static vs Dynamic</h2>
<p>Static routes are typed by hand; dynamic ones are learned with a <strong>routing protocol</strong>.</p>
<blockquote>Common Mistake: thinking static routes update themselves.</blockquote>
<figure><img src="${MEDIA}" alt="A routing table"><figcaption>The <strong>routing table</strong> on R1.</figcaption></figure>`,

  "lesson-violations": `<h1>One</h1><h1>Two</h1>
<h2>Concept</h2><h2>Exam Tips</h2><h2>Remember</h2>
<h4>Too deep</h4>
<p>Some <span>span</span> and <script>alert(1)</script> and <SPAN>again</SPAN>.</p>
<blockquote>Note: this is not a label but goes on and on for quite a while, more than sixty characters 😀 long.</blockquote>
<blockquote><strong>Exam Tip:</strong> fine.</blockquote>
<img src="https://example.com/x.png" alt="">
<figure><img src="slide-01-1.png" alt="x"><figcaption>cap</figcaption><p>extra</p></figure>`,

  "quiz-valid": `<h1>Routing Quiz</h1>
<h2>Q1. What does a router do?</h2>
<ol><li>Forwards packets</li><li>Prints pages</li></ol>
<blockquote>Reasoning: routers forward between networks.</blockquote>
<blockquote><strong>Answer:</strong> 1</blockquote>
<h2>Q2. Which route wins?</h2>
<blockquote>Reasoning: longest match.</blockquote>
<blockquote>Answer: the most specific</blockquote>`,

  "quiz-violations": `<h1>Bad Quiz</h1>
<h2>Q1. First</h2>
<blockquote>Answer: wrong order</blockquote>
<blockquote>Reasoning: second</blockquote>
<h2>Q3. Skipped two</h2>
<blockquote>Reasoning: only one</blockquote>
<h2>Summary</h2>
<h3>Deep</h3>
<figure><img src="${MEDIA}" alt="x"><figcaption>c</figcaption></figure>`,

  "reply-fenced": "Here is the lesson you asked for:\n\n```html\n<h1 class=\"t\">Fenced <em>Title</em></h1>\n<p>Body &lt;tag&gt; &quot;quoted&quot; it&#39;s.</p>\n</p>\n```\n\nLet me know if you need changes.",

  "reply-no-h1": "CANNOT READ SOURCE: the PDF is scanned images only.",

  "reply-h1-no-close": "<h1>Never closed",

  "unicode-long": `Intro text before any heading, with &nbsp;spaces&nbsp; and an &AMP; entity.
<h1>การกำหนดเส้นทาง — Routing 🚀</h1>
<p>${"เราเตอร์ส่งต่อแพ็กเก็ตระหว่างเครือข่าย ".repeat(6)}This sentence ends here. ${"Another clause without an end ".repeat(5)}</p>
<H2 ID="x">Upper Case Heading</H2>
<p>${"Word ".repeat(70)}Final.</p>
<h3>Unclosed heading
<p>Still the same section? <strong>Alpha</strong> <strong>alpha</strong> <code>Beta</code> <strong>${"x".repeat(61)}</strong> <strong>  </strong></p>
<h3>Keywords</h3>
<p>${Array.from({ length: 20 }, (_, i) => `<strong>term${i}</strong>`).join(" ")} <code>multi
line</code> <strong>nested <code>inner</code> outer</strong></p>
<h2>Empty</h2>
<h2>Last</h2><p>Done 🎉.</p>`,
};

const out = { media: MEDIA, cases: [], slugs: [], vault: null };
for (const [name, input] of Object.entries(fixtures)) {
  const html = validate.extractHtml(input);
  const chunked = chunker.chunkHTML(input);
  out.cases.push({
    name,
    input,
    checkLesson: validate.checkLesson(input),
    checkQuiz: validate.checkQuiz(input),
    extractHtml: html,
    titleOf: validate.titleOf(input),
    chunkTitle: chunked.title,
    chunks: chunked.chunks.map((c, idx) => ({
      idx,
      topic: c.topic,
      heading: c.heading,
      heading_index: c.headingIndex,
      summary: c.summary,
      keywords: c.keywords,
      body: c.body,
      html: c.html,
    })),
  });
}

for (const title of ["Routing Basics & Tables", "  --Hello, World!--  ", "การกำหนดเส้นทาง", "", "TCP/IP: Layer 4 (Transport)", "a".repeat(10)]) {
  out.slugs.push({ title, slug: slugify(title).toLowerCase() });
}

// lib/ai/vault.ts's encryptKey, with a fixed secret and IV.
const secret = Buffer.alloc(32, 7);
const key = Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), "notecom ai keys v1", 32));
const iv = Buffer.alloc(12, 3);
const owner = "11111111-2222-3333-4444-555555555555";
const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
cipher.setAAD(Buffer.from(`${owner}|anthropic`));
const body = Buffer.concat([cipher.update("sk-ant-test-0123456789", "utf8"), cipher.final()]);
out.vault = {
  secret: secret.toString("base64"),
  owner,
  service: "anthropic",
  stored: ["v1", iv.toString("base64"), body.toString("base64"), cipher.getAuthTag().toString("base64")].join(":"),
  plain: "sk-ant-test-0123456789",
};

writeFileSync(path.join(here, "parity.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${out.cases.length} cases, ${out.slugs.length} slugs`);
