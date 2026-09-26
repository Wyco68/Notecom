# HTML Output Contract

Loaded by `/lect` only. Enforced two ways — keep all three in sync when
this contract changes:
- [lib/vault/sanitize.ts](../lib/vault/sanitize.ts) strips anything
  outside the tag allowlist before a lesson is ever rendered.
- [lib/generate/validate.ts](../lib/generate/validate.ts) checks every
  generated lesson against the rules below (headings, callouts, tags)
  before the app saves it, and sends violations back to the `/lect`
  session to fix — see [lect.md](../.claude/commands/lect.md).

## Format (strict)
Generated lesson content is **semantic HTML only** — never Markdown, never
a file path, never a filename decision (naming stays with the app's save
path, not with content generation). Allowed tags only:

```
h1 h2 h3 p ul ol li
table thead tbody tr td th
pre code blockquote strong em
div class="mermaid"
div class="viz-process-flow"
div class="viz-timeline"
div class="viz-layer-stack"
div class="viz-block-diagram"
```

- No inline styles, no `<style>`, no `<script>`.
- No custom classes except the visualization classes listed above.
- No styling decisions at all — presentation belongs entirely to React
  (colors, spacing, typography, callouts, tables, code blocks, diagrams,
  animation, dark mode). See [ui-guidelines.md](ui-guidelines.md) for how
  the app renders this.

**Mermaid diagrams** (for sequences, state machines, decision trees, and
complex connected graphs): Mermaid source inside `<div class="mermaid">...</div>`.
Write standard Mermaid syntax only. Never include `style`, `classDef`,
`linkStyle`, `%%{init`, theme directives, or colors — the app sets all
styling. Hydrated client-side by the React Mermaid component.

**Structured visualization components** (for everything else): a `<div>`
with one of the four viz classes listed above, containing only a JSON
object as its text content — no HTML inside, no line breaks. The React
component parses the JSON and owns all presentation.

| Class | Best for | JSON shape |
|---|---|---|
| `viz-process-flow` | Sequential chains, request/response flow, algorithms | `{"steps":["A","B","C"]}` or `{"steps":[{"label":"A","desc":"tooltip"}],"direction":"vertical","title":"optional"}` |
| `viz-timeline` | Boot sequences, scheduling, ordered events | `{"title":"optional","items":[{"label":"Step","desc":"detail"}]}` |
| `viz-layer-stack` | OSI model, TCP/IP, memory hierarchy, software stacks | `{"title":"optional","layers":[{"name":"Application","detail":"HTTP, FTP"},...]}` — first element renders at the top |
| `viz-block-diagram` | CPU components, hardware blocks, peer components | `{"title":"optional","blocks":["ALU","CU"],"columns":2}` or `{"blocks":[{"label":"A","desc":"detail"}]}` |

Use `viz-*` when the concept maps cleanly to one of those shapes.
Use Mermaid when the diagram needs arrows between arbitrary nodes,
subgraphs, or genuine sequence/state/decision-tree logic.
Use a `<table>` for comparisons — never a diagram.

## Heading scheme (strict — only these, never deeper than `h3`, no emoji)
Every lesson uses this fixed set of headings, repeated per concept.
Consistency beats novelty — students learn the structure once.

```
h1  Lesson Title
h2  Overview
h2  Concept: <Specific Concept Name>
h2  How it Works
h2  Example
h2  Gotcha
h2  Summary
```

Repeat `Concept: <Name>` through `Gotcha` once per major concept.

**`Concept` must always carry the specific concept's name after the
colon** (e.g. `Concept: What Is Reliability?`, `Concept: Chaos
Engineering`) — never emit a bare `Concept` heading with no name. This is
the one heading that disambiguates the whole repeated block; everything
else in this scheme (`How it Works`, `Example`, `Gotcha`) stays exact
plain text with no suffix, since it's understood to belong to the nearest
preceding `Concept:` heading.

**No standalone `Exam Tips` or `Remember` heading** — go straight from
`Gotcha` into the `Exam Tip:`/`Remember:` callout (see Callouts below).
The callout box already renders its own label, so a heading above it is a
duplicate. Don't emit one.

Never invent new heading names beyond adding the concept name to
`Concept:`. Never use `h4`+ (no heading deeper than `h3`). Plain text
headings only — no emoji, ever.

## Callouts (strict)
Four callout types only, rendered as colored boxes by React. Emit each as
a `<blockquote>` whose text begins with the label:

- `Key Idea:` — core insight of a concept
- `Common Mistake:` — the specific trap to avoid
- `Exam Tip:` — sample question + answer
- `Remember:` — memorable closing takeaway

Use sparingly — only when they improve readability, never invent more.
No emoji prefix.

**Order and labeling, per concept block:** after `Gotcha`, emit exactly
one `Exam Tip:` callout, then exactly one `Remember:` callout — no heading
above either, the callout's own label is the section title.

`Key Idea:` and `Common Mistake:` callouts belong inside `Concept:`,
`How it Works`, `Example`, or `Gotcha` where relevant — never use them in
place of the closing `Exam Tip:`/`Remember:` pair.

## Formatting rules (strict)
- **Emphasis:** `<strong>` only for key terms or the single most important
  phrase — never whole sentences. `<code>` for commands, protocols,
  keywords, filenames, variables, ports, config values.
- **Lists:** `<ul>` for related-but-unordered ideas, `<ol>` for ordered
  processes — each `<li>` = one action only.
- **Tables:** use a `<table>` whenever comparing 2+ concepts/protocols/
  terms — never compare inside prose. Keep cells short.
- **Diagrams:** one visualization per concept (Mermaid or a `viz-*`
  component — choose the type that best communicates the concept), inside
  that concept's section, followed by a one-line explanation. Pick the
  simplest type that works: prefer `viz-layer-stack` over a `flowchart TD`
  chain, `viz-process-flow` over a simple `flowchart LR`, `viz-timeline`
  over a numbered list when order and progression matter.
- **Code:** `<pre><code>` for code/commands, kept small and focused.
