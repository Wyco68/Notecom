# /assignment

## Purpose
Handle a university programming assignment start-to-finish in a structured
workflow, and keep a permanent learning journal that ties the classroom
theory in the lesson vault to the real implementation.

## Load (and only these)
- [docs/assignment-guidelines.md](../../docs/assignment-guidelines.md) —
  journal structure + save rules.
- [docs/api-contract.md](../../docs/api-contract.md) — the vaultd
  `POST /assignment` save endpoint.

Do not load teaching/lesson/quiz docs — this command is neither lesson nor
quiz generation.

## Required inputs (stop if any missing)
1. **GitHub repository URL.**
2. **Subject** — an **existing** vault subject folder.
3. **Assignment/task description.**

If any of the three is missing, stop immediately and request exactly the
missing input(s). Do not guess and do not start work.

## Workspace (strict)
Cloned repos live in a sibling directory **outside** this notes repo:

```
../assignment-workspace/<repo-name>
```

Work only inside that clone. Never modify any repository outside
`../assignment-workspace/`, and never touch this notes repo's own source.

## Workflow (run in this exact order)

1. **Clone / pull.** Clone the GitHub URL into
   `../assignment-workspace/<repo-name>`. If it already exists there, `git
   pull` — never re-clone, never create a duplicate.

2. **Repository research.** Before writing any code, understand the project:
   structure, architecture, frameworks, coding conventions, build process,
   dependencies, existing implementation, reusable components, design
   patterns. Do not start implementing until the project is understood.

3. **Lecture research.** Resolve the given subject against existing `vault/`
   folders (same rule as `/lect`/`/quiz`: an obvious match wins; no
   reasonable match → ask, never invent a new subject). Search that
   subject's lessons for concepts related to the assignment (e.g. GraphQL,
   Operating Systems, Networking, React, Next.js, Database, Compiler,
   Algorithms). Prefer existing lesson content. If needed theory is
   missing, state exactly what is missing before implementing.

4. **Plan.** Produce a short plan: understanding of the task, affected
   modules, implementation strategy, risks, assumptions. Do not code yet.

5. **Implement.** Follow the cloned repo's conventions, reuse its existing
   components, avoid unnecessary refactoring, keep changes focused, and only
   touch files the assignment requires.

6. **Journal.** Create and continuously update the learning journal per
   [assignment-guidelines.md](../../docs/assignment-guidelines.md) —
   `vault/<subject-slug>/assignment-<id>.html` saved via vaultd
   `POST /assignment` (run `node scripts/ensure-vaultd.mjs` first). Update
   it throughout the work; append progress, never delete history.

## Completion
When the assignment is done:
- Verify the cloned project **builds** successfully.
- Verify the task requirements are satisfied.
- Do a final journal update (Final Implementation + Reflection).
- Summarize the completed work, and recommend improvements if appropriate.

## Restrictions (strict)
- Never modify this notes repo's application source (`app/`, `components/`,
  `lib/`, `tools/`, `desktop/`).
- Never generate or edit lessons or quizzes.
- Never modify any repository outside `../assignment-workspace/`.
- The journal is the only file this command writes into `vault/`.

## Redirect rule
- Notes-app development → `/feat`.
- Lesson content → `/lect`.
- Quiz content → `/quiz`.
Do not do that work here.
