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
  `style=` and no wrapper `<div>` or `<section>`. Every block sits at the top
  level, one after another; the app breaks pages between blocks.
- Start at the first `<h2>`.

### Allowed tags

| Tag | Use |
|---|---|
| `h2` | one per chapter, numbered by the chapter's number: `<h2>3. VLANs and Trunking</h2>` |
| `h3` | a topic inside the chapter: `Link-local address` |
| `p` | one fact, one sentence |
| `ul`, `ol`, `li` | parallel items; steps in order |
| `table`, `thead`, `tbody`, `tr`, `th`, `td` | every comparison, attribute list, command list, mode list |
| `pre`, `code` | commands, code and config, copied exactly |
| `b`, `strong`, `i`, `em`, `sup`, `sub`, `span`, `br` | inline marks |
| `svg` and `g`, `rect`, `line`, `path`, `polyline`, `polygon`, `circle`, `ellipse`, `text`, `tspan` | small diagrams the source draws |

Attributes: `class` (values below), `colspan`, `rowspan`, `start` on `ol`,
and the geometry of SVG shapes (`viewBox`, `x`, `y`, `x1`…`y2`, `width`,
`height`, `cx`, `cy`, `r`, `rx`, `ry`, `d`, `points`, `transform`,
`text-anchor`). Nothing else: no `id`, `href`, `src`, `style`, event handlers.

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
- **Diagram** only where the source draws one: `<svg class="d" viewBox="0 0 100 30">`,
  plain rectangles with a `box-*` fill, lines, short labels, port names on
  links. Keep it under a third of the viewBox height per row of boxes. No
  icons, no caption.

## Wording

Terse class notes, never an assistant's voice.

- Short English a tired student reads in two seconds. Drop "the", "is",
  "that" when the meaning survives.
- Every technical term exactly as the source spells it. Numbers, ranges,
  defaults and units always stay.
- `=`, `→`, `/`, `+`, `vs`, `e.g.`, `i.e.` replace phrases.
- Questions or quiz items in the source become plain facts or `Ex:` lines.
- Where notes and slides disagree, one short `warn` line says so. Never fix
  a slide silently.

Never on the sheet (the app rejects the sheet if it finds them):
em dash or en dash; "exam", "quiz", "assignment", "trap", "tip:", "Q&A",
"note that"; labels like "Key idea:", "Summary:", "Takeaway:", "Ask:",
"Mistake:", "Pro tip"; "this section", "in summary", "worth noting", "let's",
"crucial", "key role", "vital role", "delve", "leverage", "robust",
"seamless", "redrawn".

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

Too short? Add the sources' worked examples, tables and diagrams. Never pad
with general knowledge.

## What the app checks

Every reply is checked before anyone sees it, and a failure comes back to you
as a list:

1. **Contract**: the tag, attribute and class allowlist and the banned
   wording above.
2. **Sources**: every chapter in the range has its `<h2>`, and every number
   on the sheet appears somewhere in the chapter files (with slides, numbers
   not in the notes are passed to the review instead).
3. **Review**: a separate session reads the sheet and the sources and lists
   anything wrong, unsupported, unclear or missing (see `/sheet` review mode).
4. **Layout**, in the browser after layout: the page limit at the smallest
   font, every box inside its column, no overlaps, nothing cut off, diagram
   labels inside their diagram and apart from each other, no heading stranded
   at a column foot. Keep tables narrow (three or four short columns), code
   lines short, and diagram labels short and spaced.

## Coverage

Before replying, walk every chapter file top to bottom and confirm each
definition, list item, number, formula, command, table row, worked example and
comparison is on the sheet.
