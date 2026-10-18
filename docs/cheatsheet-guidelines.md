# Cheatsheet guidelines

Loaded by `/sheet` only. Self-contained: it defines the cheatsheet's purpose,
its tag and class allowlist, its wording rules and how to fit a page limit.

## What a cheatsheet is

One printed A4 sheet set, the only paper a student takes into the room. It
holds every fact of the chosen chapters, fits the page limit, and reads like
notes the student typed in Word the night before: packed, plain, exact.

The app sends the chapters (the course's lesson notes, one file per chapter)
and, sometimes, the original slides. Those files are the only source. Nothing
from general knowledge goes on the sheet.

## Output: a flat HTML fragment

Reply with the sheet body only. The app wraps it in its own page, picks the
paper, columns and font, splits it into pages and prints it. So:

- No `<html>`, `<head>`, `<body>`, `<style>`, `<script>`, `<h1>`, no inline
  `style=` and no `<section>`. A `<div>` only ever as one of the boxes below.
  Every block sits at the top level, one after another; the app breaks pages
  between blocks, and a box moves as one block.
- Before the fragment, one line starting `NOTE:` for the reader (what the
  sheet covers, or what an edit changed). It is shown in the sheet's
  conversation and never printed. The fragment starts at the first `<h2>`.

### Allowed tags

| Tag | Use |
|---|---|
| `h2` | one per chapter, numbered by the chapter's number: `<h2>3. VLANs and Trunking</h2>` |
| `h3` | a topic inside the chapter: `Link-local address` |
| `p` | one fact, one sentence |
| `ul`, `ol`, `li` | parallel items; steps in order |
| `table`, `thead`, `tbody`, `tr`, `th`, `td` | every comparison, attribute list, command list, mode list |
| `pre`, `code` | commands, code and config, copied exactly; `code` also inline for a command, file or keyword |
| `div` | a box, only with one of the box classes below |
| `hr` | the dashed rule between the two halves of a comparison box |
| `b`, `strong`, `i`, `em`, `sup`, `sub`, `span`, `br` | inline marks |
| `svg` and `g`, `rect`, `line`, `path`, `polyline`, `polygon`, `circle`, `ellipse`, `text`, `tspan` | small diagrams the source draws |
| `img` | a slide picture a chapter already shows (see Pictures below) |

Attributes: `class` (values below), `colspan`, `rowspan`, `start` on `ol`,
the geometry of SVG shapes (`viewBox`, `x`, `y`, `x1`…`y2`, `width`,
`height`, `cx`, `cy`, `r`, `rx`, `ry`, `d`, `points`, `transform`,
`text-anchor`), and on `img` only `src`, `alt`, `width`, `height`. Nothing
else: no `id`, `href`, `style`, event handlers, and `src` on nothing but an
`img`.

### Classes

| Class | On | Means |
|---|---|---|
| `ex` | `p`, `li`, `span` | example line, starts with `Ex:`; orange |
| `warn` | `p`, `li`, `span` | a common mix-up or limit; red, no label |
| `key` | `span`, `b` | a key term worth spotting; purple |
| `f` | `p` | a formula on its own line; purple |
| `c` | `span` inside `pre` | a code comment; grey |
| `d` | `svg` | a diagram (required on every `svg`) |
| `box-b`, `box-g`, `box-y`, `box-r`, `box-w` | `rect` | blue, green, yellow, red, white fill |
| `box` | `div` | a group of related facts: light blue, blue edge |
| `cmp` | `div` | a comparison of two to four things: teal frame, ▸ bullets |
| `bt` | `p` | the title of a `cmp` box, its first child: `Interrupt vs Trap vs Syscall` |
| `box-warn` | `div` | a mix-up to avoid: light red, red edge, no label |
| `box-key` | `div` | a rule of thumb or a fact to remember: light violet, violet edge |

## Elements

- **Fact line.** `<p>IPv6 = 128 bit = 2<sup>128</sup> addresses.</p>` Most of
  the sheet is this. No bullet.
- **Bold** the term being defined, the number that matters, the command
  name. Never a whole sentence.
- **Arrow** `→` for "becomes", "leads to", "then":
  `<pre>2001:0DB8:0000:0000:0000:0000:1428:57AB
→ 2001:DB8::1428:57AB</pre>`
- **Equals** `=` for definitions: `Prefix = host bits zeroed.`
- **Example:** `<p class="ex">Ex: Fred sends to 0200.3333.3333 (Wilma).</p>`
- **Warning:** `<p class="warn">Link-local (FE80::, automatic) is not Unique Local (FD, chosen by you).</p>`
- **Memory hook,** only if the source gives one: `"Switch cuts collisions, router cuts broadcasts."`
- **Table** first column names the thing. Common shapes: `Aspect | IPv4 | IPv6`,
  `Command | Shows`, `Field | Bytes`, `Concept | Caused by | Example`.
- **Boxes** make the sheet scannable, as in the reader's reference sheet.
  Use them where the sources group things, not on every fact — most of the
  sheet stays plain lines and tables:
  `<div class="box"><ul><li><b>Process Mgmt:</b> create, delete, suspend, resume processes.</li>…</ul></div>`
  `<div class="cmp"><p class="bt">Interrupt vs Trap</p><ul><li>Caused by hardware → <b>interrupt</b>.</li>…</ul><hr><ul><li><b>Interrupt = asynchronous.</b></li></ul></div>`
  `<div class="box-warn"><p>Protection (inside, access control) ≠ security (outside threats).</p></div>`
  `<div class="box-key"><p>A blocking call always means Running → <b>Waiting</b>.</p></div>`
  A box holds a few lines; never nest boxes. The wording rules apply inside
  them too: no "Ask:", "Mistake:", "Rule of thumb:" labels — the colour says it.
- **Diagram** only where the source draws one: `<svg class="d" viewBox="0 0 100 30">`,
  plain rectangles with a `box-*` fill, lines, short labels, port names on
  links. Keep it under a third of the viewBox height per row of boxes. No
  icons, no caption.
- **Picture**, the slide's own figure, where the chapter shows one (below).

## Pictures

The lessons carry the slides' real pictures: a `<figure>` with an
`<img src="/api/media/…">` and a caption. When a chapter file has any, it
starts with a comment that pairs each picture's `src` with a file you can
look at.

- **Put one on the sheet when it carries facts the text does not**: a
  figure the notes only point at (a disk's structure, a memory layout, a
  protocol exchange, a screenshot of output), or one that says in a glance
  what would take several lines. Never as decoration, never two that show
  the same thing.
- **A simple box-and-line figure is drawn instead**, as a small SVG: it
  costs less space and prints sharper. A picture is for what an SVG can't
  say cheaply (photos, dense diagrams, real output).
- **Copy the lesson's tag exactly** — `src`, `width`, `height` — and give
  it a short `alt`: `<img src="/api/media/…/….jpg" width="1087" height="1061"
  alt="Paging hardware: page table maps p to f">`. Never invent or change a
  `src`; the app rejects any other address. The picture fills its column's
  width; follow it with one fact line that says what to read off it, not a
  caption.
- **Open the file only to decide.** The comment's file is there so you can
  judge a picture; the facts still come from the chapter's text.
- A picture takes real space: count it as about four lines of the budget
  per column-width, and it is the first thing to drop when the sheet is
  too long.
- Never write that a slide "is only a picture" or "shows a figure": either
  the picture goes on the sheet, or what it says goes on as text, or it
  stays off.

## Wording

Terse class notes, never an assistant's voice.

- **One sentence per line.** Every sentence is its own `<p>` or `<li>`;
  never two sentences run together on one line. A line that needs a
  second sentence becomes two lines.
- **Simple words, simple explanations.** Everyday English a high-school
  student knows, around the technical terms. Explain a term in a few plain
  words, not a textbook sentence: `Thrashing = more time paging than
  working.` If an explanation needs a clause inside a clause, split it.
- Short English a tired student reads in two seconds. Drop "the", "is",
  "that" when the meaning survives.
- Every technical term exactly as the source spells it. Numbers, ranges,
  defaults and units always stay.
- `=`, `→`, `/`, `+`, `vs`, `e.g.`, `i.e.` replace phrases.
- Questions or quiz items in the source become plain facts or `Ex:` lines,
  stated with their correct answer: "Ring 0 (centre) = most power." A
  question the reader added as a source (a question bank, with answers)
  goes into its own chapter, merged with the fact already there instead of
  repeated; one that adds nothing new is left out.
- Where notes and slides disagree, one short `warn` line says so. Never fix
  a slide silently.

Never on the sheet (the app rejects the sheet if it finds them):
em dash or en dash; "exam", "quiz", "assignment", "trap", "tip:", "Q&A",
"note that"; labels like "Key idea:", "Summary:", "Takeaway:", "Ask:",
"Mistake:", "Pro tip"; "this section", "in summary", "worth noting", "let's",
"crucial", "key role", "vital role", "delve", "leverage", "robust",
"seamless", "redrawn". When the chapters themselves use "trap",
"assignment" or one of the words from "crucial" to "seamless" (an SNMP trap,
IP address assignment), it is a term: keep it as the source spells it.

## Fitting the page limit

The prompt gives the page limit, the layout and a character budget (visible
text, spaces excluded). Aim for 90 to 100% of the budget: under it leaves
paper empty, over it will not fit.

Too long? Compress in this order, and never drop a fact silently:

1. Cut filler words. "The switch will then forward the frame" → "Switch forwards frame".
2. Turn two or more parallel sentences into a table.
3. Join short facts about the same thing on one line with `;`.
4. Merge the same fact said in notes and slides.
5. Shrink or drop a diagram a table already covers.
6. Drop a picture whose facts are already on the sheet as text.

Too short? Add the sources' worked examples, tables, diagrams and the
pictures that carry facts. Never pad with general knowledge.

**No page limit.** The prompt may say there is none. Then there is no budget:
cover every fact of the chapters in full, in the same compressed note style,
as many pages as that takes. Still no padding and nothing from outside the
sources.

The paper, the columns and the font are the app's. For a page-limited sheet
it tries 2 to 8 columns and every font in range, and keeps the largest
readable font that fills the pages; so aim for the budget and it will fit.
Keep tables to three or four short columns, since a column may be narrow.

**Chapter by chapter.** A new sheet is written one chapter per run (chapter
mode, see `/sheet`), each with its own share of the budget, so a run that
stops part-way keeps what is done. Write each chapter as if the others were
already there: no repeating them, no "see chapter 2".

## What the app checks

Every reply is checked before anyone sees it, and a failure comes back to you
as a list:

1. **Contract**: the tag, attribute and class allowlist, a picture's `src`
   being one a lesson uses, and the banned wording above. Markup outside the allowlist is never saved; anything else
   that fails is saved with the sheet as an open check the reader can send
   back to you.
2. **Sources**: every chapter in the range has its `<h2>`, and every number
   on the sheet appears somewhere in the chapter files (with slides, numbers
   not in the notes are passed to the review instead).
3. **Review**, when the reader runs it: a separate session reads one
   chapter's section and its sources and lists anything wrong, unsupported,
   unclear or missing (see `/sheet` review mode).
4. **Layout**, in the browser after layout: the page limit at the smallest
   font, every box inside its column, no overlaps, nothing cut off, diagram
   labels inside their diagram and apart from each other, no heading stranded
   at a column foot. Keep tables narrow (three or four short columns), code
   lines short, and diagram labels short and spaced.

## Coverage

Before replying, walk every chapter file top to bottom and confirm each
definition, list item, number, formula, command, table row, worked example and
comparison is on the sheet, and that each picture you left off says nothing
the sheet lacks.
