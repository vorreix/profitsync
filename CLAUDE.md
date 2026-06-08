# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Skills — reach for these proactively

A set of skills (plus the Workflow tool) is installed for this repo. **When a task matches one, invoke it BEFORE writing code — don't wait to be asked.** Project-specific skills override generic knowledge. Process skills come first (brainstorm/research → build → review).

| Skill | Reach for it when |
|---|---|
| `subscription-system` | **Any** billing/subscription/plan/invoice work — Dodo Payments, webhooks, the `/admin` subscription & organization panels, or touching the `subscriptions`/`invoices`/`plans` tables. Establishes the *Dodo-is-money / DB-is-mirror* model — invoke it **first** so you don't break the sync invariants. |
| `brainstorming` | Before **any** creative work (new feature, component, behavior change) — explore intent, requirements, and design before implementing. |
| `ui-ux-pro-max` | Planning, building, reviewing, or improving any UI/UX — styles, color systems, font pairings, layout, accessibility, charts. |
| `transition-creator` | Adding/polishing animations or transitions (View More, accordions, lists, modals/drawers, hover, page changes) or fixing janky/flickering motion — then verifying it feels seamless in a real browser. |
| `shadcn` | Working with shadcn/ui components (search + examples). Remember the repo rule: install via `npx shadcn@latest add`, never edit `src/components/ui/` directly. |
| `work-finetuning` | A large multi-task brief to execute autonomously end-to-end — stacked branches, mobile-first UX, optimistic in-place updates (no full-screen reloads), Playwright verification, the full pre-commit gate, a pushed branch per task. |
| `deep-research` | A deep, multi-source, fact-checked research report is needed. Narrow scope with 2–3 clarifying questions first if the ask is underspecified. |
| `code-review` | Review the current diff for correctness bugs + simplification/efficiency cleanups. `--comment` posts inline PR comments, `--fix` applies findings; `ultra` runs a cloud multi-agent review. |
| `requesting-code-review` | Finishing a task or major feature, or before merging — verify the work actually meets requirements. |
| `receiving-code-review` | After getting review feedback, before implementing suggestions — verify rather than perform agreement. |
| `skill-creator` / `writing-skills` | Creating, editing, optimizing, or testing a skill. |
| `mcp-integration` | Adding or configuring an MCP server (`.mcp.json`, SSE/stdio/HTTP server types). |

**Workflow tool (`/workflow`):** deterministic multi-agent orchestration for large or parallelizable work — fan-out exploration, multi-angle review, migrations across many files. Ultracode is on for this repo, so prefer orchestrating substantive tasks through a workflow; keep trivial/conversational turns solo.

**Session commands the user types (suggest them when useful — the agent cannot run these):** `/skills` (list installed skills), `/clear` (start a fresh context), `/compact` (summarize a long context), `/resume` (continue a past session), `/reload-plugins` (after changing skills/plugins), `/mcp` (view/manage MCP connections).

## Commands

```bash
vercel dev           # Start dev server (Vite frontend + API functions on port 3000)
npm run dev          # Vite-only frontend (no API — use vercel dev for full-stack)
npm run build        # Type-check then bundle for production
npm run typecheck    # TypeScript type check across all three tsconfig files
npm run preview      # Preview production build locally
npm run lint         # ESLint (eslint.config.js)
npm run test         # Vitest in watch mode
npm run test:ci      # Vitest single-run (CI)
npm run db:generate  # Generate Drizzle migration SQL from schema changes
npm run db:migrate   # Run pending Drizzle migrations (node scripts/db-migrate.mjs)
npm run db:push      # Push schema directly to Neon (dev shortcut — skips migrations)
npm run seed-blog    # Seed/refresh SEO/GEO pillar blog posts (scripts/seed-blog.ts, idempotent)
npm run i18n:check   # Verify every locale has all en.json keys (placeholders intact)

npx vitest run src/lib/foo.test.ts        # Run a single test file
npx vitest run -t "name of the test"      # Run tests matching a name
```

A husky **pre-commit hook** (`.husky/pre-commit`, installed via the `prepare` script on `npm install`) gates every commit with: `i18n:check` → `lint` → `typecheck` → `test:ci`. TypeScript (`tsc --noEmit`) and ESLint are the primary static analysis tools. Test coverage is partial — unit tests live in `src/lib/*.test.ts`.

**CI mirrors the hook.** `.github/workflows/pr.yml` runs the same gate (`i18n:check` → `lint` → `typecheck` → `test:ci`) on every PR and on pushes to `main`/`dev`, so commits made with `--no-verify` (or by contributors who never ran `npm install`) are still caught server-side. `.github/CODEOWNERS` assigns review and `.github/PULL_REQUEST_TEMPLATE.md` is the PR scaffold. Keep the hook and the workflow in sync when changing the gate.

## Environment

The app requires these env vars in `.env.local` (never commit this file):

```
# Auth (Clerk)
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...   # Browser-side Clerk key
CLERK_SECRET_KEY=sk_test_...             # Server-side only — never expose to browser

# Database (Neon)
DATABASE_URL=postgresql://...            # Neon connection string

# Billing (Dodo Payments — optional in dev)
DODO_PAYMENTS_API_KEY=...
DODO_PAYMENTS_WEBHOOK_SECRET=whsec_...
DODO_PAYMENTS_ENVIRONMENT=test_mode      # or live_mode
DODO_PRODUCT_PREMIUM_MONTHLY=...         # Dodo product id
DODO_PRODUCT_PREMIUM_YEARLY=...          # Dodo product id
```

## Architecture

**Stack:** React 19 + TypeScript + Vite, Tailwind CSS v4 (via `@tailwindcss/vite` plugin), shadcn/ui (new-york style), react-router-dom v7, react-hook-form + zod, Clerk (auth), Neon (Postgres via Drizzle ORM), Vercel serverless functions (`api/` directory), recharts, i18next (8 locales), Vitest.

**Path alias:** `@/` resolves to `src/`.

### Routing (`src/App.tsx`)

All pages are lazy-loaded (`React.lazy` + `Suspense`) for code splitting. Route groups:

| Group | Paths | Shell |
|---|---|---|
| Public legal | `/privacy-policy`, `/terms-of-service` | None |
| Public blog | `/blog`, `/blog/:slug` | None (marketing — reuses `src/landing/` design + isolated i18n) |
| Invitation | `/invitations/:token` | None (handles sign-in inline) |
| Auth | `/login/*`, `/signup/*`, `/forgot-password`, `/reset-password` | None (Clerk requires `/*` glob) |
| Admin | `/admin`, `/admin/users`, `/admin/organizations`, `/admin/organizations/:id`, `/admin/subscriptions`, `/admin/invoices`, `/admin/plans`, `/admin/blog` | `AdminLayout` |
| App | `/dashboard`, `/clients`, `/clients/:id`, `/transactions`, `/quotations`, `/organizations`, `/organizations/:id/members`, `/subscription`, `/trash`, `/profile` | `AppLayout` |

### AppLayout (`src/components/AppLayout.tsx`)

Auth guard using Clerk's `useAuth()` — redirects to `/login` if unauthenticated. On mobile (`useIsMobile()`) renders `MobileAppLayout` instead of the sidebar shell.

When signed in, wraps children with three context providers (in order):
1. `OrgProvider` (`src/lib/org-context.tsx`) — active org, org list, switchOrg
2. `AdminProvider` (`src/lib/admin-context.tsx`) — isAdmin flag (checked via `/api/admin/me`)
3. `CurrencyProvider` (`src/lib/currency-context.tsx`) — derives currency from `activeOrg.currency`

The sidebar has a floating action button (FAB) for quick access to Add Client, Add Transaction, and Create Quotation.

### Context providers

| Provider | Hook | Source of truth |
|---|---|---|
| `OrgProvider` | `useOrg()` | Fetches `/api/profile` + `/api/organizations` in parallel at boot |
| `AdminProvider` | `useAdmin()` | Fetches `/api/admin/me`; 401 → not admin |
| `CurrencyProvider` | `useCurrency()` | Derived from `activeOrg.currency` |

### Data layer

**Types** are in `src/lib/types.ts`. **Schema** lives in `src/lib/db/schema.ts`.

| Type | Table | Key fields |
|---|---|---|
| `Organization` | `organizations` | `owner_user_id`, `slug`, `is_personal`, `currency`, `plan_key`, `plan_status` |
| `Client` | `clients` | `organization_id` (scoping), `status`: `active\|inactive\|archived`, soft-delete via `deleted_at` |
| `Transaction` | `transactions` | `client_id` (FK, cascade delete), `type`: `incoming\|outgoing`, `category`, `date` |
| `Quotation` | `quotations` | `organization_id`, `status`: `draft\|sent\|accepted\|rejected`, `linked_client_id` (set on convert) |
| `UserProfile` | `user_profiles` | `id` = Clerk userId, `currency`, `language`, `current_organization_id`, `terms_accepted_at` |
| `TransactionAttachment` | `transaction_attachments` | `file_data` (base64, stored in DB) |
| `QuotationAttachment` | `quotation_attachments` | `file_data` (base64, stored in DB) |
| `OrganizationMember` | `organization_members` | `role`: `owner\|admin\|editor\|viewer` |
| `OrganizationInvitation` | `organization_invitations` | `token` (unique), `expires_at` |
| `Plan` | `plans` | `key`: `free\|premium`, `limits` (jsonb), `geo_pricing` (jsonb) |
| `Subscription` | `subscriptions` | `organization_id`, `plan_key`, `status`: `active\|past_due\|cancelled\|trialing` |
| `Invoice` | `invoices` | `organization_id`, `status`: `draft\|open\|paid\|uncollectible\|void\|refunded` |
| `AppAdmin` | `app_admins` | `user_id` (Clerk userId) |
| `LegalAcceptance` | `legal_acceptances` | `document`: `privacy_policy\|terms_of_service` |
| `BlogPost` | `blog_posts` | **global** (not org-scoped — admin-authored), `slug` (unique), `status`: `draft\|published`, `content` (Markdown), `published_at`, `reading_time_minutes` |

`CURRENCIES` (ISO code list) and `LEGAL_DOC_VERSION` are exported from `src/lib/types.ts`.

**Drizzle helpers:**
- `db` and `serialize()` are in `src/lib/db/index.ts`. `serialize()` converts Drizzle's camelCase row keys to snake_case before `res.json()` — call it on every row returned from an API route.
- Migrations are in `drizzle/` and run automatically on `vercel-build` (`scripts/db-migrate.mjs`).

### API layer — consolidated router

To stay within Vercel Hobby's 12-function cap, **all** route handlers live under `api/_routes/**` (the `_` prefix makes Vercel skip them). A single function `api/index.ts` receives every `/api/*` request (via a `vercel.json` rewrite) and dispatches via a lightweight router in `src/lib/api-router.ts`.

**Critical routing rule:** static routes must precede same-depth dynamic siblings in the route table (e.g. `["organizations", "switch"]` before `["organizations", ":id"]`).

**Exception:** `api/billing/webhook.ts` is its own Vercel function because it needs `bodyParser: false` for signature verification. The filesystem route is served before the catch-all rewrite.

**Exception:** `api/ssr.ts` is its own Vercel function for SEO/GEO (see below).

#### SEO / GEO — server-rendered public pages (`api/ssr.ts`)

The app is a client-rendered SPA, which is invisible to crawlers/AI engines that don't run JS. `api/ssr.ts` server-renders the **public** pages so they ship real `<head>` (title, description, canonical, hreflang, OG/Twitter, JSON-LD) and a content snapshot in the initial HTML:

- `vercel.json` rewrites `/`, `/blog`, `/blog/:slug`, `/privacy-policy`, `/terms-of-service`, `/refund-policy`, `/sitemap.xml`, `/robots.txt`, `/llms.txt` to `/api/ssr?__ssrpath=…` (SSR routes precede the SPA fallback; `/api/*` stays first). App routes (`/dashboard`, `/admin`, …) keep serving the static shell and are `Disallow`ed in robots.txt.
- It reads the built `index.html` (copied to `api/_ssr/index-template.html` by `vite.config.ts` `ssrTemplatePlugin`, bundled via `functions.includeFiles`, gitignored) and injects into the `<!--SSR_HEAD_START/END-->` and `<!--SSR_ROOT-->` sentinels in `index.html`. Safe because the app boots with `createRoot().render()` (not `hydrateRoot`) — the snapshot is replaced on boot, **no hydration risk**.
- Shared, pure SEO builders live in `src/lib/seo/site.ts` (constants, `buildHead`, JSON-LD). Markdown→HTML for post snapshots uses `marked` + `sanitize-html` in `api/_ssr/markdown.ts` (allowlist mirrors `src/components/Markdown.tsx`).
- **Blog SEO/GEO:** `blog_posts` carries author E-E-A-T columns (`author_job_title`, `author_bio`, `author_url`, `author_image_url`), a dedicated `og_image_url`, and `article_section`. The SSR emits a rich `BlogPosting` (Person author + sameAs/jobTitle/image, `wordCount`, `keywords`, `dateModified`, `inLanguage`, `isAccessibleForFree`, `articleSection`) plus a visible author byline. An `## FAQ`/`## Frequently asked questions` section is auto-detected (`extractFaq` in `src/lib/blog.ts`) and emitted as FAQPage JSON-LD. Cover/OG images become `<image:image>` sitemap entries.
- **Auto-indexing of new/edited posts:** the dedicated **default OG image** is `public/og-image.png` (1200×630; source `scripts/og-image.html`). Publishing/editing a live post pings **IndexNow** (`api/_lib/indexnow.ts`, Bing/Yandex/Naver; prod-only, fire-and-forget) and refreshes the sitemap. Key file: `public/<INDEXNOW_KEY>.txt`. `robots.txt` welcomes all major AI crawlers (training **and** retrieval — max visibility) via the `AI_CRAWLERS` list in `api/ssr.ts`; **review that list quarterly**. Seed/refresh pillar content with `npm run seed-blog` (`scripts/seed-blog.ts`, idempotent). Full plan + content playbook + keyword clusters: **`docs/seo/PLAN.md`**.
- **Prod-only:** in `npm run dev` the public pages are served by Vite (CSR); test SSR with `vercel dev` after a build.
- **Caveat:** Vercel may serve static `dist/index.html` for `/` before the rewrite (filesystem precedence). The landing still carries Organization/WebSite/SoftwareApplication JSON-LD baked statically into `index.html` (now with the 1200×630 OG image, dimensions, `og:locale`, canonical), so it degrades gracefully; `/blog/*` and the rest have no static collision and always SSR. The `www`→apex 301 is a Vercel **domain setting**, not code.

#### Route table (as of current codebase)

| Path | File |
|---|---|
| `/api/profile` | `_routes/profile.ts` — GET (upsert on first call) + PATCH |
| `/api/clients` | `_routes/clients.ts` — GET all + POST |
| `/api/clients/:id` | `_routes/clients/[id].ts` — GET + PATCH + DELETE |
| `/api/transactions` | `_routes/transactions.ts` — GET (by `?clientId=`) + POST |
| `/api/transactions/:id` | `_routes/transactions/[id].ts` — PATCH + DELETE |
| `/api/transactions/:id/attachments` | `_routes/transactions/[id]/attachments.ts` — GET + POST |
| `/api/quotations` | `_routes/quotations.ts` — GET + POST |
| `/api/quotations/:id` | `_routes/quotations/[id].ts` — GET + PATCH + DELETE |
| `/api/quotations/:id/attachments` | `_routes/quotations/[id]/attachments.ts` — GET + POST |
| `/api/quotations/:id/convert` | `_routes/quotations/[id]/convert.ts` — POST (creates a Client) |
| `/api/organizations` | `_routes/organizations.ts` — GET + POST |
| `/api/organizations/switch` | `_routes/organizations/switch.ts` — POST |
| `/api/organizations/:id` | `_routes/organizations/[id].ts` — GET + PATCH + DELETE |
| `/api/organizations/:id/members` | `_routes/organizations/[id]/members.ts` |
| `/api/attachments/:id` | `_routes/attachments/[id].ts` — GET + DELETE |
| `/api/quotation-attachments/:id` | `_routes/quotation-attachments/[id].ts` — GET + DELETE |
| `/api/invitations/:token` | `_routes/invitations/[token].ts` |
| `/api/legal/accept` | `_routes/legal/accept.ts` |
| `/api/trash` | `_routes/trash.ts` — GET soft-deleted items |
| `/api/trash/restore` | `_routes/trash/restore.ts` — POST |
| `/api/trash/purge` | `_routes/trash/purge.ts` — POST |
| `/api/public/blog` | `_routes/public/blog.ts` — GET published list (no auth, no `content`) |
| `/api/public/blog/:slug` | `_routes/public/blog/[slug].ts` — GET published post (no auth) |
| `/api/billing/pricing` | `_routes/billing/pricing.ts` |
| `/api/billing/create-subscription` | `_routes/billing/create-subscription.ts` |
| `/api/billing/cancel` | `_routes/billing/cancel.ts` |
| `/api/billing/sync` | `_routes/billing/sync.ts` |
| `/api/billing/webhook` | `api/billing/webhook.ts` (**separate function**) |
| `/api/admin/me` | `_routes/admin/me.ts` |
| `/api/admin/stats` | `_routes/admin/stats.ts` |
| `/api/admin/users` | `_routes/admin/users.ts` |
| `/api/admin/user-detail` | `_routes/admin/user-detail.ts` |
| `/api/admin/clients` | `_routes/admin/clients.ts` |
| `/api/admin/transactions` | `_routes/admin/transactions.ts` |
| `/api/admin/organizations` | `_routes/admin/organizations.ts` |
| `/api/admin/org-detail` | `_routes/admin/org-detail.ts` |
| `/api/admin/subscriptions` | `_routes/admin/subscriptions.ts` |
| `/api/admin/invoices` | `_routes/admin/invoices.ts` |
| `/api/admin/invitations` | `_routes/admin/invitations.ts` |
| `/api/admin/plans` | `_routes/admin/plans.ts` |
| `/api/admin/blog` | `_routes/admin/blog.ts` — GET all + POST (admin-only) |
| `/api/admin/blog/:id` | `_routes/admin/blog/[id].ts` — GET + PATCH (incl. publish/unpublish) + DELETE |

### Auth & authorization (`api/_lib/auth.ts`)

Every route calls `requireAuth(req, res)` which:
1. Verifies the Clerk JWT from `Authorization: Bearer <token>`.
2. Resolves the active org from the `x-org-id` request header (falling back to `profile.current_organization_id`, then the personal org).
3. Returns `OrgAuth = { userId, orgId, role }` or writes a 401/403 and returns `null`.

An in-process LRU cache (TTL 60 s) avoids a DB round-trip on every API call for org membership.

Role helpers:
- `canWrite(role)` — `owner | admin | editor`
- `canDelete(role)` — `owner | admin`

All DB queries are scoped by `orgId`, not `userId`. Never bypass this.

### Client-side API (`src/lib/api.ts`)

`apiGet`, `apiPost`, `apiPatch`, `apiDelete` all attach `Authorization: Bearer <token>` and `x-org-id: <activeOrgId>`.

`apiGet` has a 30-second GET cache with in-flight deduplication (collapses concurrent identical fetches) and LRU eviction at 50 entries. Any mutation (`apiPost/apiPatch/apiDelete`) calls `clearApiCache()` to invalidate all cached responses.

Use `setActiveOrgId(id)` when the active org changes; it clears the cache and persists to `localStorage`.

### Quota enforcement (`api/_lib/quota.ts`)

Free-plan limits (default: 10 clients, 30 tx/client, 30 quotations, 1 MB attachments, 1 attachment/tx, 200-char notes). Premium limits are much higher and stored in the `plans` table (`limits` jsonb).

Check functions: `checkClientQuota`, `checkTransactionQuota`, `checkQuotationQuota`, `checkAttachmentQuota`, `checkNoteLength`. Each returns `QuotaCheck = { allowed: true } | { allowed: false; reason; limit; current?; upgradeHint }`. Return HTTP 403 with the `reason` string when not allowed.

### Billing (`api/_lib/dodo.ts`)

Dodo Payments (Merchant of Record) is the payment provider. Subscriptions use hosted checkout (`payment_link: true`). Webhook verification uses Standard Webhooks spec (HMAC-SHA256, `whsec_` prefix stripped).

`productIdForPlan(planKey, cycle)` resolves product IDs from env vars. `mapDodoStatus(dodoStatus)` translates Dodo's status strings to internal ones.

### Internationalization (`src/lib/i18n/`)

8 supported locales: `en`, `it`, `de`, `hi`, `ml`, `ta`, `te`, `ar`. Arabic (`ar`) is RTL — the i18n setup syncs `<html dir>` on language change. English is the fallback for missing keys.

Language is stored in `localStorage` under key `profitsync-language`. Use the `useTranslation()` hook from `react-i18next` for all user-visible strings. Add new keys to `en.json` first, then propagate to **every** other locale file.

`en.json` is the source of truth for which keys must exist. `npm run i18n:check` (`scripts/check-i18n.mjs`, run by the pre-commit hook) fails if any locale is missing a key, has an empty value, or drops an interpolation `{{placeholder}}` — so a new English key cannot be committed until all 7 other locales are translated. The `_one`/`_zero`/`_two` plural variants are allowed to omit `{{count}}` (idiomatic in some languages). For bulk backfills, `scripts/i18n-merge.mjs` deep-merges a `{ lang: { "dotted.key": value } }` map into the locale files (additive, preserves order).

### UI components

`src/components/ui/` contains shadcn components — treat these as vendored. Do not edit them directly; add new ones with `npx shadcn@latest add <component>`.

Custom components in `src/components/`:
- `AppLayout` — sidebar shell + auth guard + providers
- `MobileAppLayout` — bottom-tab navigation for mobile
- `OrgSwitcher` — org picker in the sidebar header
- `CurrencyCombobox` — reusable currency selector
- `LanguageSwitcher` — language picker (icon variant in sidebar footer)
- `LegalLayout` — wrapper for legal pages
- `mode-toggle` / `theme-provider` — dark/light mode via `next-themes`

### Theme

Dark/light mode via `next-themes` (`ThemeProvider` in `src/components/theme-provider.tsx`). Tailwind CSS variables drive theming (`cssVariables: true` in `components.json`).

## Key conventions

- **Scoping:** All DB writes and reads must use `orgId` from `requireAuth()`. Never use `userId` alone to scope client/transaction/quotation queries.
- **Serialization:** Always call `serialize(row)` before `res.json(row)` in API handlers to convert camelCase Drizzle output to snake_case.
- **Adding a new API route:** (1) Create handler in `api/_routes/`, (2) import it in `api/index.ts`, (3) add an entry to the `routes` array (static before dynamic at same depth).
- **Adding a Vercel function** that needs raw body (e.g. webhooks): place it directly in `api/` (not `_routes/`) so Vercel treats it as its own function. Count against the 12-function cap.
- **Mutations invalidate cache:** any `apiPost/apiPatch/apiDelete` call clears the entire GET cache. Do not cache mutation responses.
- **Role checks before writes:** call `canWrite(role)` or `canDelete(role)` and return 403 before any mutation.
- **Quota checks before creates:** call the relevant `check*Quota` helper before inserting clients, transactions, quotations, or attachments.
- **i18n strings:** all UI text goes through `useTranslation()`. Raw English strings in JSX are a bug.
- **Form validation:** use `react-hook-form` + `zod` resolvers. Do not roll custom validation.
- **shadcn components:** install via CLI, never edit `src/components/ui/` directly.

## Product context

See `project_idea.md` for the full spec. Key domain concepts:

- **Organizations** are the central multi-tenancy unit. Every client, transaction, and quotation belongs to an org, not directly to a user. Each user gets a personal org on first login.
- **Clients** are the main entity. Status: `active | inactive | archived`. Support soft-delete (trash/restore/purge).
- **Transactions** (`incoming | outgoing`) belong to a client and drive financials. Support file attachments.
- **Quotations** (`draft | sent | accepted | rejected`) can be converted to clients via `/api/quotations/:id/convert`. Support file attachments.
- **Plans:** `free` (limited) and `premium` (Dodo Payments subscription). Limits are stored in the `plans` table and enforced server-side via `api/_lib/quota.ts`.
- **Admin console** (`/admin/**`) is restricted to users in the `app_admins` table. Seed via `scripts/seed-admin.ts`.
- **Currency** is set per-org. `useCurrency()` reads `activeOrg.currency` throughout the UI.
