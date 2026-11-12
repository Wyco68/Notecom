# generator

Writes Notecom lessons and quizzes on the VPS, with each reader's own AI key,
from a queue fed by a transactional outbox. Why and how it fits the app:
[docs/architecture.md](../../docs/architecture.md), "The generator on the VPS".

```
 browser ──POST /api/jobs──▶ app (Vercel)
                              │  signs the upload's read URL as the reader
                              ▼
            notes_enqueue_job (one transaction)
            ├─ notes_jobs        row, runner = 'vps'
            ├─ notes_job_outbox  'filed'
            └─ NOTIFY notes_job_outbox (on commit)
                              │
 ┌──────────── VPS ───────────┼──────────────────────────────────────────┐
 │  generator                 ▼                                          │
 │   relay  ── LISTEN / poll ─ take → publish → mark (one transaction) ──┼─▶ nats (JetStream,
 │   worker ◀── pull, one message per free slot ──────────────────────────┤   work queue, on disk)
 │     claim (notes_gen_claim) → read upload (signed URL) → AI call      │
 │     → contract check → fix rounds → save doc + chunks + result       │
 │     progress + lease + ack wait renewed every 15 s                    │
 └──────────────────────────────────────────────────────────────────────┘
 browser polls GET /api/jobs/[id] for the log, as for any job
```

| Path | What |
|---|---|
| `cmd/generator` | entry point: relay and worker (`MODE=all\|relay\|worker`), health endpoint, graceful hand-back on stop |
| `internal/relay` | outbox → JetStream |
| `internal/queue` | the JetStream stream (`NOTECOM_JOBS`, work-queue retention) and durable consumer (`generator`) |
| `internal/worker` | claim, steps, heartbeat, hand-back, save |
| `internal/store` | every database call — the `notes_gen_*` functions and nothing else |
| `internal/ai` | Claude (official Go SDK, fallbacks on), OpenAI, OpenRouter, Gemini — fixed hosts |
| `internal/contract`, `internal/search` | ports of `lib/generate/validate.ts` and `lib/search/chunker.ts`, held to them by `testdata/parity.json` |
| `internal/source`, `internal/uploads`, `internal/vault`, `internal/prompt` | upload → message parts, signed-URL reads, key decryption, system prompt from `docs/` |
| `deploy/` | compose file, NATS config, env template and `deploy.sh` for the VPS |

## One-time setup

1. **Database** — apply `supabase/migrations/0036_notes_generator_outbox.sql`,
   then give the role a password, in the Supabase SQL editor (keep the
   password out of git and chat):

   ```sql
   alter role notes_generator with login password '<openssl rand -base64 32>';
   ```

2. **VPS** (`carpart`, user `deploy`) — the generator lives beside the other
   apps but on its own network; Caddy is not involved.

   ```bash
   mkdir -p ~/server/apps/notecom-generator && cd ~/server/apps/notecom-generator
   # copy deploy/docker-compose.yml, deploy/nats.conf, deploy/deploy.sh here
   echo "NATS_TOKEN=$(openssl rand -hex 32)" > .env && chmod 600 .env
   cp .env.example .env.production && chmod 600 .env.production   # then fill it in
   ./deploy.sh
   ```

   `DATABASE_URL` uses the **session** pooler (port 5432) with the user
   `notes_generator.<project-ref>`, in keyword form so the password needs no
   URL-encoding; `AI_KEYS_SECRET` is the app's own.
   The box is already logged in to `ghcr.io` (its other apps pull from it),
   so the image pulls whether or not the package is public.

3. **App** — set `GENERATOR_RUNNER=vps` in the Vercel project's environment
   and redeploy. Lessons and quizzes filed from then on go to the VPS;
   unset it to go back. Jobs already filed keep their runner.

## Deploying

Pushing to `main` builds `ghcr.io/wyco68/notecom-generator:sha-<commit>` (and
`latest`) after the tests pass. Then, on the VPS:

```bash
~/server/apps/notecom-generator/deploy.sh sha-<commit>
```

Running jobs save the reply so far and go back in the queue when the old
container stops; the new one continues them. To have CI do this, set the
repository variable `GENERATOR_DEPLOY=true` and the secrets `VPS_HOST`,
`VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS` (production environment).

## Operating

- Logs: `docker logs -f notecom-generator` (JSON, one line per event; keys
  and upload tokens are never logged).
- Health: the container's healthcheck (`/generator -healthcheck`) — database
  reachable and NATS connected.
- Queue: `docker exec notecom-nats wget -qO- 'http://127.0.0.1:8222/jsz?streams=true'`.
- Stuck job? The page shows its log. A job whose message was lost is filed
  again within ~11 minutes; any job is given up on six hours after filing.
- Rotating `AI_KEYS_SECRET` makes every saved key unreadable (readers save
  theirs again) — rotate it here and on Vercel together.
- Memory on the 1 GB box: ~4 MB idle each for the generator and NATS; a job
  sending a 20 MB PDF peaks around 80 MB. Limits are in the compose file.

## Testing

```bash
cd tools/generator
go test ./...                       # unit tests, incl. parity with the TypeScript
scripts/it.sh                       # end to end: Postgres 17 + NATS in Docker
node testdata/parity.mjs            # after changing validate.ts / chunker.ts / slug.ts
```

`internal/it` files jobs as a reader, runs the relay and worker with a
stand-in AI service, and checks: a lesson written, fixed once and saved with
its chunks; a shutdown mid-reply handed back and continued by the next
worker; a reader's Stop noticed mid-call; a folder whose write access was
lost left untouched; a bad upload token reported to the reader; and what
`authenticated` and `notes_generator` may not do.
