# Quiz Guidelines

Loaded by `/quiz` only. Defines the quiz HTML contract — a sibling of
[html-output-contract.md](html-output-contract.md), not lesson content, so
it gets its own doc instead of overloading the lesson heading scheme.

Enforced by the app, not by `/quiz`: `lib/generate/validate.ts` checks
every generated quiz before it is saved, and sends violations back to the
session to fix.

## Format (strict)
Quiz content is **semantic HTML only**, same allowed-tag allowlist as
lessons:

```
h1 h2 h3 p ul ol li
table thead tbody tr td th
pre code blockquote strong em
div class="mermaid"
div class="viz-process-flow" | "viz-timeline" | "viz-layer-stack" | "viz-block-diagram"
```

No inline styles, no `<style>`, no `<script>`, no custom classes beyond the
viz classes above. No styling decisions — presentation belongs to React
(same renderer as lessons, see [ui-guidelines.md](ui-guidelines.md)).

## Structure (strict)

```
h1  Quiz Title
h2  Q1. <question text>
    blockquote  Reasoning: <the reasoning worked through to reach the answer>
    blockquote  Answer: <the final answer, stated plainly>
h2  Q2. <question text>
    blockquote  Reasoning: ...
    blockquote  Answer: ...
```

- One `h2` per question, always starting with `Q<n>.` where `<n>` is a
  1-based, strictly increasing counter across the whole file, starting at
  `Q1.`.
- Immediately under each question's `h2`: exactly one `Reasoning:`
  callout, then exactly one `Answer:` callout, in that order. No other
  content between a question's `h2` and its two callouts.
- `Reasoning:` must show real work — the chain of thought that gets from
  the question to the answer, not a restated answer. `Answer:` is the
  final answer alone, no hedging, no re-derivation.
- A question may use a `<table>`, `<pre><code>`, or one `viz-*`/`mermaid`
  diagram between the `h2` and its `Reasoning:` callout when the question
  itself needs to show source material (a code snippet, a diagram to
  interpret) — never inside the callouts themselves.
- Never use `h3` inside a quiz file — the scheme is flat, one `h2` per
  question, no sub-headings.

## Where content comes from

**From an uploaded file.** The user uploads a file of questions in the
app's Generate dialog, which also picks the destination folder. Read every
question in it (after markitdown conversion, unless it is already
Markdown), and for each one produce a `Q<n>.` block: the question as the `h2`
text, worked `Reasoning:`, and a plain `Answer:`. If the Markdown already
states an answer, verify it by re-deriving it — the `Reasoning:` and
`Answer:` here are `/quiz`'s own output, not a copy of the source file's
answer key.
