# Read-only deployment: Vercel front-end + GitHub + Cloudflare Worker

Loaded by `/feat` only. This is the **second multi-device viewer channel**
(alternative to [deploy-vercel-gcs.md](deploy-vercel-gcs.md)): the desktop
app on your main machine stays the sole author (generates lessons via the
local Claude Code CLI, exactly as before), and a read-only copy of the app
is hosted on Vercel. The notes travel through a **private** GitHub repo
(`lecture-content`) that the desktop pushes to; a Cloudflare Worker
(`workers/content-api/`) mirrors that repo into Workers KV and serves it to
Vercel over a small token-protected API.

```
 Desktop (writer)              GitHub (private)         Cloudflare Worker          Vercel (reader)
 ┌───────────────────┐  push   ┌────────────────┐ hook  ┌────────────────────┐ API ┌────────────────────┐
 │ /lect /quiz →     │ ──────▶ │ lecture-content │ ────▶ │ content-api        │ ──▶ │ Next.js, read-only  │
 │ npm run           │  git    │ repo (vault/    │ sync  │ Workers KV mirror  │     │ VAULT_SOURCE=worker │
 │ sync:content      │         │ mirror)        │       │ + search           │     │                    │
 └───────────────────┘         └────────────────┘       └────────────────────┘     └────────────────────┘
```

Nothing about the desktop app changes: leave `VAULT_SOURCE` unset locally
and it keeps talking to vaultd/indexd. The Vercel build only ever **reads**;
every write path (upload/generate, new folder, rename, delete) and chat are
disabled there in both UI and API (see `middleware.ts`,
`components/layout/AppShell.tsx`) — exactly the same blocking as the gcs
mode.

---

## Part A — GitHub content repo + token (one-time)

You need a GitHub account. These steps happen on github.com; the app can't
do them for you (they involve your account and credentials).

1. **Create a private repo** named `lecture-content` (empty — no README
   needed). This holds a mirror of `vault/` only, never the app source.
2. **Create a fine-grained personal access token** (Settings → Developer
   settings → Fine-grained tokens):
   - Repository access: **only** the `lecture-content` repo.
   - Permissions: **Contents: Read-only** — nothing else.
   - This token is what the Worker uses to read the repo. Treat it like a
     password; it can't write anything by design.

## Part B — deploy the Worker (one-time)

From the repo root:

```bash
cd workers/content-api
npm install

# 1. create the KV namespace and paste its id into wrangler.jsonc
npx wrangler kv namespace create CONTENT

# 2. set the three secrets
npx wrangler secret put API_TOKEN        # invent a long random token — Vercel uses it
npx wrangler secret put WEBHOOK_SECRET   # invent another — GitHub webhook uses it
npx wrangler secret put GITHUB_TOKEN     # the fine-grained PAT from Part A

# 3. deploy
npx wrangler deploy
```

Before deploying, check the `vars` in `wrangler.jsonc`: `GITHUB_REPO` must
be `<user>/lecture-content` and `GITHUB_BRANCH` is `main`. The deploy
prints your Worker URL, e.g. `https://content-api.<account>.workers.dev`.

## Part C — GitHub webhook (one-time)

On the `lecture-content` repo: Settings → Webhooks → Add webhook:

- Payload URL: `https://content-api.<account>.workers.dev/webhook`
- Content type: `application/json`
- Secret: the `WEBHOOK_SECRET` value from Part B
- Events: **just the push event**

The Worker verifies every delivery's `X-Hub-Signature-256` header (HMAC
SHA-256, constant-time compare), ignores non-push events and pushes to
other branches, and syncs asynchronously — it returns 200 immediately and
updates KV in the background.

## Part D — push your vault (each time you add notes)

On the desktop, from the repo root:

```bash
npm run sync:content
```

That one command (`scripts/sync-content.mjs`) rebuilds
`vault/.search-index.json` (via `scripts/build-search-index.mjs`), then
commits and pushes `vault/` to the content repo. The webhook does the rest.

Notes:
- It uses a **detached git dir** at `.content-git/` (gitignored): `vault/`
  itself is the work tree, so no `.git` ever appears inside the vault and
  the main repo is untouched.
- The **first run** needs the remote URL in the environment:

  ```bash
  CONTENT_REPO_URL=https://github.com/<user>/lecture-content.git npm run sync:content
  ```

  After that the remote is remembered. `CONTENT_BRANCH` defaults to `main`.
- `.index/` (indexd's local SQLite) and `.quiz-state.json` are excluded via
  `.content-git/info/exclude` — desktop-only, useless on the hosted site.
- Push is a normal push first; on rejection it fetches and retries with
  `--force-with-lease`, up to 3 attempts.

## Part E — deploy to Vercel

1. Push this repo to GitHub (private repo is fine) and **Import** it at
   <https://vercel.com/new>. Framework preset: Next.js (auto-detected).
2. In the Vercel project's **Settings → Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `VAULT_SOURCE` | `worker` |
   | `NEXT_PUBLIC_VAULT_SOURCE` | `worker` |
   | `CONTENT_API_URL` | `https://content-api.<account>.workers.dev` |
   | `CONTENT_API_TOKEN` | *(the `API_TOKEN` value from Part B)* |

   No GCS vars are needed in this mode. The `NEXT_PUBLIC_` copy of
   `VAULT_SOURCE` is what hides the write buttons + chat in the browser;
   the non-prefixed one drives the server.

3. **Deploy.** Vercel builds and gives you a URL. Open it on any device —
   you get the same reader UI, browsing the notes from the Worker, with
   search working and no upload / new-folder / chat controls.

4. **Protect it** (recommended, since it's your notes on a public URL):
   Vercel → Settings → Deployment Protection → enable **Vercel
   Authentication** (or Password Protection) so only you can open it.

## How the Worker sync works

On a webhook (or `POST /sync`), the Worker diffs the git tree's blob SHAs
against a manifest stored in KV and fetches **only changed files** from
GitHub. In KV:

| Key | Content |
|---|---|
| `doc:<folder>/<id>` | one document's HTML + metadata (`{title}` from the first `h1`) |
| `idx:<folder>` | one folder's `index.json` |
| `tree` | the prebuilt full tree response |
| `search-index` | the keyword search index (`vault/.search-index.json`) |
| `manifest` | blob SHAs of the last sync, for diffing |

The Worker API itself (all endpoints bearer-token-protected except
`/webhook`) is documented in [api-contract.md](api-contract.md). Useful for
checking on things: `GET /status` returns
`{ ok, commitSha, syncedAt, docCount }`, and `POST /sync` (bearer token,
answers 202) forces a re-sync without a push.

Freshness: push → webhook → KV sync. KV propagation plus a 60-second
in-Worker search cache mean new content can lag a push by ~1–2 minutes —
fine for lecture notes.

## Env var reference

| Var | Where | Purpose |
|---|---|---|
| `VAULT_SOURCE=worker` | Vercel (server) | Read vault from the content-api Worker instead of vaultd; middleware blocks writes + chat. |
| `NEXT_PUBLIC_VAULT_SOURCE=worker` | Vercel (client) | Hide upload / new-folder / chat buttons. |
| `CONTENT_API_URL` | Vercel | The Worker's URL. |
| `CONTENT_API_TOKEN` | Vercel (secret) | Bearer token for the Worker API (its `API_TOKEN` secret). |
| `CONTENT_REPO_URL` | Desktop (first sync only) | Remote URL of the private `lecture-content` repo. |
| `CONTENT_BRANCH` | Desktop (optional) | Content repo branch, defaults to `main`. |

Leaving all of these unset is the normal desktop/local mode — vaultd +
indexd, fully writable — so the same codebase serves both.

## What is and isn't available on the hosted reader

Identical to the gcs mode; the only operational difference is the update
flow — after generating lessons, one `npm run sync:content` replaces the
gcs mode's two manual commands, and the webhook handles the rest.

| Feature | Desktop (vaultd) | Vercel (worker) |
|---|---|---|
| Browse folders / read lessons, quizzes, assignments | ✅ | ✅ |
| Search | ✅ hybrid (indexd + Ollama) | ✅ keyword (prebuilt index, same scoring as gcs) |
| Generate (upload → `/lect` `/quiz`) | ✅ | ❌ hidden + 403 |
| New folder / rename / delete | ✅ | ❌ hidden + 403 |
| Ask My Notes (chat) | ✅ local model | ❌ hidden + 403 |
| "Related lessons" | ✅ | ❌ (returns empty) |
