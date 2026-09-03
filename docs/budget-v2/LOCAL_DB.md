# Local development database (Budget v2)

> Why this exists: the app speaks to Postgres **only** through
> `@neondatabase/serverless` + `drizzle-orm/neon-http`. Before this, there was no
> way to run ProfitSync against a local database — `.env.local` had to point at a
> shared Neon instance, which meant every schema experiment landed on data other
> people were using.

## What it gives you

A **Neon-protocol-compatible** endpoint backed by a plain local Postgres, so the
application's driver works **unchanged**.

That last point matters more than convenience. `neon-http` has **no interactive
transactions** — only `db.batch()` — and Budget v2's audit invariants are designed
around exactly that constraint (see `SMART_HYBRID_BUDGET_SPEC.md` §10.13).
Developing locally on `node-postgres` would silently permit transactions that fail
in production. Keeping the real driver and correcting only the *endpoint* preserves
parity.

## Start it

The compose file takes its credentials from `docs/budget-v2/.env.localdb`, which
is gitignored — throwaway values for a loopback-bound container, but kept out of
the repository so no default password is ever committed. Create it once:

```bash
cat > docs/budget-v2/.env.localdb <<EOF
LOCAL_DB_USER=psdev
LOCAL_DB_PASSWORD=$(openssl rand -hex 16)
LOCAL_DB_NAME=main
EOF
```

```bash
docker compose --env-file docs/budget-v2/.env.localdb   -f docs/budget-v2/docker-compose.localdb.yml up -d
```

Three seconds later you have:

| Service | Host port | Purpose |
|---|---|---|
| `postgres:16-alpine` | `55432` | the actual database (`main`) |
| Neon proxy (`local-neon-http-proxy`) | `4444` | HTTPS SQL-over-HTTP on `/sql`, i.e. what the driver speaks |

## Use it

```bash
set -a; . docs/budget-v2/.env.localdb; set +a
export DATABASE_URL="postgres://$LOCAL_DB_USER:$LOCAL_DB_PASSWORD@db.localtest.me:4444/$LOCAL_DB_NAME?sslmode=require"   # secret-scan:ignore
export NODE_TLS_REJECT_UNAUTHORIZED=0     # the proxy serves a self-signed cert

npm run db:migrate      # applies the whole journal from zero
npm run dev             # http://localhost:5173  (API included, see vite localApiPlugin)
```

`db.localtest.me` is a public DNS alias for `127.0.0.1`; it is used instead of
`localhost` because the Neon proxy selects its TLS certificate by SNI.

**`.env.local` is never modified.** `vite.config.ts` loads it *without*
`override: true`, so an exported `DATABASE_URL` takes precedence.

## The one code change this required

`@neondatabase/serverless` builds its HTTP endpoint from the connection string's
**hostname and ignores the port**, so `…@db.localtest.me:4444/main` is POSTed to
`https://db.localtest.me/sql` on port 443 — which locally hits whatever else is
listening (on this machine, IIS, producing a baffling 404).

`src/lib/db/neon-local.ts` corrects it, and is a **no-op in production**: the
override applies only when the host is a loopback alias *and* an explicit port is
present. `scripts/db-migrate.mjs` carries the same six-line guard inline, because
it is plain `.mjs` and cannot import the TypeScript module.

## Things worth knowing

- **Never run `npm run db:push` against a shared database.** It diffs against the *live* schema, so on the team's shared Neon instance it proposes dropping the `family_*` columns that exist there from an unmerged branch. Use `db:generate` + `db:migrate`.
- A fresh local DB applies all 59 journal migrations cleanly. The shared instance has a bookkeeping anomaly (`0025_wealth_accounts` recorded as unapplied while the table exists) that would break `db:migrate` there — it does **not** affect a local DB.
- Reset to a clean slate: `docker compose -f docs/budget-v2/docker-compose.localdb.yml down -v && … up -d && npm run db:migrate`.
