# Read-only deployment: Vercel front-end + Google Cloud Storage vault

Loaded by `/feat` only. This is the **multi-device viewer**: the desktop
app on your main machine stays the sole author (generates lessons via the
local Claude Code CLI, exactly as before), and a read-only copy of the app
is hosted on Vercel so an iPad / laptop / phone can browse the notes from
anywhere. The notes themselves live in a **private** Google Cloud Storage
bucket that the desktop pushes to and Vercel reads from.

```
 Desktop (writer)                     Google Cloud Storage            Vercel (reader)
 ┌───────────────────┐   sync         ┌──────────────────┐   read     ┌───────────────────┐
 │ /lect /quiz →     │ ─────────────▶ │  private bucket   │ ─────────▶ │ Next.js, read-only │
 │ vault/ + indexd   │  gcloud rsync  │  vault/ mirror    │  SA creds  │ VAULT_SOURCE=gcs   │
 └───────────────────┘                └──────────────────┘            └───────────────────┘
```

Nothing about the desktop app changes: leave `VAULT_SOURCE` unset locally
and it keeps talking to vaultd/indexd. The Vercel build only ever **reads**;
every write path (upload/generate, new folder, rename, delete) and chat are
disabled there in both UI and API (see `middleware.ts`,
`components/layout/AppShell.tsx`).

---

## Part A — Google Cloud Storage (one-time)

You need a Google account. These steps happen in the Google Cloud console
and on your desktop; the app can't do them for you (they involve your
billing account and credentials).

1. **Create a project** at <https://console.cloud.google.com> (e.g.
   `lecturelens`). Enable billing (GCS has a generous always-free tier;
   a personal vault costs approximately nothing).
2. **Create a bucket** (Cloud Storage → Buckets → Create):
   - Name: globally unique, e.g. `yourname-lecturelens-vault`.
   - Location: a single region near you (cheapest).
   - Access control: **Uniform**.
   - **Keep "Enforce public access prevention" ON** — the bucket stays
     private; Vercel reads it with a service account, not public URLs.
3. **Create a service account** (IAM & Admin → Service Accounts → Create):
   - Name: `lecturelens-reader`.
   - Grant it the role **Storage Object Viewer** (read-only) on the bucket
     (Bucket → Permissions → Grant access → paste the service-account
     email → role Storage Object Viewer). Read-only by design.
   - Create a **JSON key** for it (Keys → Add key → JSON) and download it.
     Treat this file like a password.

## Part B — push your vault to the bucket (each time you add notes)

On the desktop, from the repo root:

```bash
# 1. build the keyword search index (indexd can't run on Vercel)
npm run build:search-index

# 2. mirror vault/ into the bucket under a "vault/" prefix
#    (install the gcloud CLI once: https://cloud.google.com/sdk)
gcloud storage rsync -r -x '\.index/.*' ./vault gs://<your-bucket>/vault
```

Notes:
- The `-x '\.index/.*'` skip leaves indexd's local SQLite index behind —
  it's desktop-only and useless on Vercel. The `.search-index.json` file
  **is** uploaded (it doesn't match that pattern) and is what powers search
  on the hosted site.
- Re-run both commands whenever you generate new lessons. (You can wrap
  them in a shell alias, or a `rclone`/Google Drive sync if you prefer.)

## Part C — deploy to Vercel

1. Push this repo to GitHub (private repo is fine) and **Import** it at
   <https://vercel.com/new>. Framework preset: Next.js (auto-detected).
2. In the Vercel project's **Settings → Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `VAULT_SOURCE` | `gcs` |
   | `NEXT_PUBLIC_VAULT_SOURCE` | `gcs` |
   | `GCS_BUCKET` | `<your-bucket>` |
   | `GCS_PREFIX` | `vault` |
   | `GCS_SERVICE_ACCOUNT_KEY` | *(the service-account JSON — see below)* |

   For `GCS_SERVICE_ACCOUNT_KEY`, **base64-encode the JSON key file first**
   so newlines survive the env-var field:

   ```bash
   base64 -w0 lecturelens-reader-key.json   # Linux
   base64 -i lecturelens-reader-key.json    # macOS
   ```

   Paste the single-line output as the value. (The app also accepts the raw
   JSON if you'd rather paste that.) The `NEXT_PUBLIC_` copy of
   `VAULT_SOURCE` is what hides the write buttons + chat in the browser;
   the non-prefixed one drives the server.

3. **Deploy.** Vercel builds and gives you a URL. Open it on any device —
   you get the same reader UI, browsing the notes from the bucket, with
   search working and no upload / new-folder / chat controls.

4. **Protect it** (recommended, since it's your notes on a public URL):
   Vercel → Settings → Deployment Protection → enable **Vercel
   Authentication** (or Password Protection) so only you can open it.

## Env var reference

| Var | Where | Purpose |
|---|---|---|
| `VAULT_SOURCE=gcs` | Vercel (server) | Read vault from GCS instead of vaultd; middleware blocks writes + chat. |
| `NEXT_PUBLIC_VAULT_SOURCE=gcs` | Vercel (client) | Hide upload / new-folder / chat buttons. |
| `GCS_BUCKET` | Vercel | Bucket name. |
| `GCS_PREFIX` | Vercel | Path prefix inside the bucket (`vault`). Omit if you synced to the bucket root. |
| `GCS_SERVICE_ACCOUNT_KEY` | Vercel (secret) | Service-account JSON (raw or base64) for read access. |

Leaving all of these unset is the normal desktop/local mode — vaultd +
indexd, fully writable — so the same codebase serves both.

## What is and isn't available on the hosted reader

| Feature | Desktop (vaultd) | Vercel (gcs) |
|---|---|---|
| Browse folders / read lessons, quizzes, assignments | ✅ | ✅ |
| Search | ✅ hybrid (indexd + Ollama) | ✅ keyword (prebuilt index) |
| Generate (upload → `/lect` `/quiz`) | ✅ | ❌ hidden + 403 |
| New folder / rename / delete | ✅ | ❌ hidden + 403 |
| Ask My Notes (chat) | ✅ local model | ❌ hidden + 403 |
| "Related lessons" | ✅ | ❌ (returns empty) |
