# ProfitSync

A multi-tenant finance app for tracking clients, transactions, and quotations
per organization, with role-based access, per-org currency, soft-delete/trash,
quota-enforced plans, and a Dodo Payments billing flow. 8-locale i18n (incl. RTL
Arabic).

## Stack

React 19 + TypeScript + Vite · Tailwind CSS v4 · shadcn/ui (new-york) ·
react-router-dom v7 · react-hook-form + zod · Clerk (auth) ·
Neon Postgres via Drizzle ORM · Vercel serverless functions (`api/`) ·
recharts · i18next · Vitest.

## Prerequisites

- Node.js 24
- A [Vercel](https://vercel.com) account + the Vercel CLI (`npm i -g vercel`) for
  full-stack local dev (the API functions need it)
- A [Neon](https://neon.tech) Postgres database and a [Clerk](https://clerk.com)
  application

## Setup

```bash
npm install              # also installs the husky pre-commit hook (via `prepare`)
```

Create `.env.local` (never commit it):

```
# Auth (Clerk)
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...   # browser-side key
CLERK_SECRET_KEY=sk_test_...             # server-side only

# Database (Neon)
DATABASE_URL=postgresql://...

# Billing (Dodo Payments — optional in dev)
DODO_PAYMENTS_API_KEY=...
DODO_PAYMENTS_WEBHOOK_SECRET=whsec_...
DODO_PAYMENTS_ENVIRONMENT=test_mode      # or live_mode
DODO_PRODUCT_PREMIUM_MONTHLY=...
DODO_PRODUCT_PREMIUM_YEARLY=...
```

Apply database migrations:

```bash
npm run db:migrate
```

## Development

```bash
vercel dev               # full-stack: Vite frontend + API functions
npm run dev              # frontend only (no API)
```

`make dev` / `make build` / `make pr` wrap the common flows — run `make` to see
all targets.

## Commands

| Command | Description |
|---|---|
| `npm run build` | Type-check then bundle for production |
| `npm run typecheck` | TypeScript check across all three tsconfig files |
| `npm run lint` | ESLint |
| `npm run test` | Vitest in watch mode |
| `npm run test:ci` | Vitest single run |
| `npm run i18n:check` | Verify every locale matches `en.json` |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Run pending migrations |
| `npm run db:push` | Push schema directly to Neon (dev shortcut) |

Run a single test: `npx vitest run src/lib/foo.test.ts` (or `-t "test name"`).

## Contributing

A husky **pre-commit hook** gates every commit with
`i18n:check → lint → typecheck → test:ci`. It is installed automatically when you
run `npm install`. The same gate runs in CI (`.github/workflows/pr.yml`) on every
pull request, so it is enforced even if the local hook is bypassed.

PRs use `.github/PULL_REQUEST_TEMPLATE.md`; reviewers are assigned via
`.github/CODEOWNERS`.

## Architecture

See [`CLAUDE.md`](./CLAUDE.md) for a detailed map of the routing, context
providers, data layer, the consolidated `api/_routes/**` router, auth/quota/billing
helpers, and i18n. The full product spec lives in [`project_idea.md`](./project_idea.md).

## Native apps

Android and iOS support is provided by Capacitor without replacing the existing web app. See [docs/native-apps.md](docs/native-apps.md) for build, sync, OAuth, and store-preparation notes.

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-pmq1yzy7)
