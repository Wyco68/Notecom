# /quiz

## Purpose
Quiz creation and maintenance only — question/reasoning/answer content,
never lesson content.

## Load (and only these)
- [docs/quiz-guidelines.md](../../docs/quiz-guidelines.md)

Do not load `docs/teaching-guidelines.md`, `docs/html-output-contract.md`,
`docs/lesson-template.md`, `docs/architecture.md`, `docs/coding-style.md`,
`docs/ui-guidelines.md`, or `docs/api-contract.md` — quiz-guidelines.md is
self-contained (it defines its own tag allowlist and structure).

## Responsibilities
- Turn a pasted Markdown file of questions into a quiz HTML file.
- Turn one pasted sentence/question into a `Reasoning:`/`Answer:` block,
  appended to a quiz file.
- Save/append quiz files to `vault/`.

## Strict flow (run in this exact order)

1. **Resolve destination (folder + quiz file).**
   - If the text after `/quiz` names a folder and/or quiz title, resolve
     the folder the same way `/lect` does: exact/obvious match against
     existing `vault/` folders wins; no reasonable match → ask the user
     (one question) whether to create a new folder or they meant an
     existing one. Never validate the folder name against the pasted
     content's topic.
   - If no folder/file was named **and** this is the first `/quiz`
     message this conversation: ask the user (one question) which folder
     and quiz title/file to use. Do not guess.
   - If no folder/file was named **and** a `/quiz` save already happened
     earlier — this conversation or a prior session — reuse that same
     target: read `vault/.quiz-state.json` (`{"folder": ..., "id": ...}`)
     and append to it instead of asking again.

2. **Get the source content.** Two shapes, both already in the
   conversation — never search the filesystem for it:
   - **Markdown file pasted/attached.** If it's already Markdown text,
     read it directly. If the user instead attaches a non-Markdown file
     (PDF, PPTX, image), convert it through the `markitdown` MCP server
     first, same reason as `/lect`: raw extraction from those formats is
     unreliable. If `markitdown` isn't connected, say so and ask the user
     to restart the session rather than eyeballing the raw file.
   - **A pasted sentence/question.** Used as-is, no conversion needed.

3. **Produce the quiz content** per
   [quiz-guidelines.md](../../docs/quiz-guidelines.md): one `Q<n>.` block
   per question, each with a worked `Reasoning:` callout and a plain
   `Answer:` callout. From a Markdown file, one block per question found
   in it. From a pasted sentence, exactly one new block.

4. **Save** per Save path below — creating a new quiz file (`Q1.` onward)
   or appending onto the resolved existing one (continuing the `Q<n>`
   count, prior blocks byte-for-byte unchanged).

## Save path

Quiz files live in the same per-subject folder as lessons, but in their
own `quizzes` index array and their own `quiz-` prefixed filename so they
never collide with a lesson of the same `<id>`:

```
vault/<folder-slug>/quiz-<id>.html   ← the generated quiz HTML
vault/<folder-slug>/index.json       ← upsert the "quizzes" array entry
```

Save via vaultd's `POST /quiz` endpoint (`{folder, id, slug, title, seq,
html}`, mirrors `POST /lesson` — see
[api-contract.md](../../docs/api-contract.md)). Make sure vaultd is
running first (`node scripts/ensure-vaultd.mjs`).

**Naming rules (must follow):**
- `<folder-slug>` = subject name lowercased, non-alphanumerics → `-`, trimmed
- `<slug>` = quiz title lowercased, non-alphanumerics → `-`, trimmed
- `<seq>` = max existing `seq` in that folder's `quizzes` array + 1 (start
  at 1 if the folder has no quizzes yet) — its own counter, independent of
  the lessons `seq` counter in the same folder
- `<id>` = `String(seq).padStart(2, "0") + "-" + slug`, e.g.
  `"02-routing-quiz"` (the on-disk file is `quiz-02-routing-quiz.html`)

**index.json `quizzes` entry shape** (same shape as a lesson entry):
```json
{ "id": "02-routing-quiz", "slug": "routing-quiz", "title": "Routing Quiz", "seq": 2 }
```

**Appending to an existing quiz file:** `GET /quiz/{folder}/{id}` first,
keep the `<h1>` and every existing `Q<n>.` block unchanged, add the new
block(s) after the last one, `POST /quiz` again with the same `id`/`slug`/
`title`/`seq` and the updated `html`.

## After saving (validate, then track state)
Validate before touching `index.json`:

```
node scripts/validate-quiz.mjs vault/<folder-slug>/quiz-<id>.html
```

Fix and re-run on any violation — never save a quiz that fails validation.

Once it passes: update `index.json`, then write
`vault/.quiz-state.json` as `{"folder": "<folder-slug>", "id": "<id>"}` so
the next `/quiz` call with no folder/file named knows to append here. That
is the final step — do **not** open a browser or start the web app. The
Notes app picks up the new quiz on its own: it refreshes when its window
regains focus, and there's a refresh button next to the theme toggle.

## Restrictions (strict)
- Never modify application code (`app/`, `components/`, `lib/`, `tools/`).
- Never modify or regenerate lesson content (`vault/**/<id>.html` without
  a `quiz-` prefix, or the `lessons` array in `index.json`).
- Never write Markdown as output — quiz output is HTML only, per
  quiz-guidelines.md.
- Never renumber or rewrite existing `Q<n>.` blocks when appending.

## Redirect rule
If the request is lesson content, stop and tell the user to use `/lect`.
If the request is application/UI work, stop and tell the user to use
`/feat`. Do not do that work here.
