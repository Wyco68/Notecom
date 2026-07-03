# Assignment Guidelines

Loaded by `/assignment` only. Defines how the assignment **learning
journal** is structured and saved. The workflow (clone → research →
implement) lives in [.claude/commands/assignment.md](../.claude/commands/assignment.md);
this doc is only about the journal artifact.

The journal is **application data**, exactly like a lesson or a quiz. It is
written by Claude Code, stored in the vault, and read (never generated) by
the Notes web app. It is its own content type — the `assignments` array in
`index.json`, with `assignment-` prefixed HTML files.

## Save target

```
vault/<folder-slug>/assignment-<id>.html   ← the journal HTML
vault/<folder-slug>/index.json             ← upsert the "assignments" entry
```

Save via vaultd's `POST /assignment` endpoint
(`{folder, id, slug, title, seq, html}`, mirrors `POST /lesson` and
`POST /quiz` — see [api-contract.md](api-contract.md)). Make sure vaultd is
running first: `node scripts/ensure-vaultd.mjs`.

**Naming rules (must follow, same shape as quizzes):**
- `<folder-slug>` = the **existing** subject folder, resolved the same way
  `/lect` and `/quiz` resolve a folder. Never create a new subject here — a
  missing subject means stop and ask.
- `<slug>` = assignment title lowercased, non-alphanumerics → `-`, trimmed.
- `<seq>` = max existing `seq` in that folder's `assignments` array + 1
  (start at 1 if the folder has no assignments yet) — its own counter,
  independent of the `lessons` and `quizzes` counters in the same folder.
- `<id>` = `String(seq).padStart(2, "0") + "-" + slug`, e.g.
  `"01-graphql-api"` (the on-disk file is `assignment-01-graphql-api.html`).

**index.json `assignments` entry shape** (same as a lesson/quiz entry):
```json
{ "id": "01-graphql-api", "slug": "graphql-api", "title": "GraphQL API", "seq": 1 }
```

## Journal structure

Semantic HTML only, in this order. Use `<h1>` for the assignment title and
`<h2>` for each section below. A `<blockquote>` renders as a callout in the
reader; `div.mermaid` renders a diagram — use them where they help.

1. **Assignment** — title, date, and the GitHub repository URL.
2. **Original Task** — the assignment description pasted **verbatim**.
3. **Repository Analysis** — architecture, important folders, technologies,
   existing patterns.
4. **Research** — the lecture/vault concepts used, and the concrete link
   between that theory and the implementation. External references if any.
5. **Decisions** — each important design decision, why it was chosen, and
   the alternatives considered.
6. **Implementation Process** — a chronological log: milestones, problems
   hit, solutions applied.
7. **Lessons Learned** — new concepts, techniques, framework features, best
   practices, mistakes to avoid.
8. **Final Implementation** — summary of completed work, files modified,
   major features.
9. **Reflection** — what to improve next time, what to optimize, how the
   work connects back to classroom knowledge.
10. **Repository** — the GitHub URL and (optional) commit hash.

## Allowed tags

The reader parses journals with the same `HtmlRenderer` as lessons, so stay
within the shared tag set: `h1 h2 h3 p ul ol li table thead tbody tr td th
pre code blockquote strong em` and `div class="mermaid"`. No inline styles,
no `<style>`/`<script>`, no custom classes other than `class="mermaid"`.

Unlike lessons and quizzes, the journal has **no strict validator** — it is
a free-form living document whose section set can grow. It only has to stay
within the allowed tag set so it renders. This is deliberate.

## Living-document rule

The journal is updated throughout the assignment, not written once at the
end. To append progress:

1. `GET /assignment/{folder}/{id}` to fetch the current HTML.
2. Add new content — never delete or rewrite prior entries; history is
   preserved.
3. `POST /assignment` again with the **same** `id`/`slug`/`title`/`seq` and
   the updated `html`.

The Notes app picks up changes on its own (it refreshes on window focus and
has a manual refresh button) — do not open a browser or start the web app.
