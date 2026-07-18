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

A husky **pre-commit hook** (`.husky/pre-commit`, installed via the `prepare` script on `npm install`) gates every commit with: secret scan → `check-esm-extensions` → `boot-functions` → `i18n:check` → `lint` → `typecheck` → `test:ci`. TypeScript (`tsc --noEmit`) and ESLint are the primary static analysis tools. Test coverage is partial — unit tests live in `src/lib/*.test.ts`.

**Prod-parity guards (NEVER remove — they exist because green CI once shipped a dead production):** the api/ functions run as **unbundled ESM on @vercel/node**, where Node's resolver needs explicit `.js` extensions on relative imports; vite/tsx/vitest all resolve extensionless imports, so only these two scripts catch it: `scripts/check-esm-extensions.mjs` (static scan of the function import graph, incl. the `src/lib` closure) and `scripts/boot-functions.mjs` (esbuild-transpiles the graph exactly like @vercel/node and **imports every function entry in real Node** — catches extensionless imports, module-scope env/config throws, JSON-import crashes; v0.4.0's `FUNCTION_INVOCATION_FAILED` outage reproduces under it). Both run in the hook and `pr.yml`; the extension scan also runs in `security.yml`.

**CI mirrors the hook.** `.github/workflows/pr.yml` runs the same gate (`i18n:check` → `lint` → `typecheck` → `test:ci`) on every PR and on pushes to `main`/`dev`, so commits made with `--no-verify` (or by contributors who never ran `npm install`) are still caught server-side. `.github/CODEOWNERS` assigns review and `.github/PULL_REQUEST_TEMPLATE.md` is the PR scaffold. Keep the hook and the workflow in sync when changing the gate.

**Other CI workflows.** `.github/workflows/security.yml` runs `scripts/secret-scan.mjs` (also first in the pre-commit hook), the route-guard sweep (`scripts/check-route-guards.mjs` — every `api/_routes` handler must call an auth guard), and a **prod** `npm audit --omit=dev --audit-level=high`. `.github/workflows/e2e.yml` runs the Playwright smoke suite (`e2e/`) on PRs into `main` and on manual dispatch. The suite has a **`prod-build` project** (`e2e/prod-build.spec.ts`, second webServer on :4317) that builds the real bundle and boots it in a browser — the dev-server projects are structurally blind to build-only breakage (a manualChunks cycle once white-screened every page of a build that passed the whole dev-server suite). `.github/workflows/post-deploy.yml` probes the live production domain after every Vercel Production deployment (API boots, authed routes 401-not-500, SSR pages, PWA artifacts) and goes red within a minute if a deploy is broken. The e2e workflow it needs the repo secrets `E2E_VITE_CLERK_PUBLISHABLE_KEY` / `E2E_CLERK_SECRET_KEY` (a Clerk **dev** instance — the testing tokens + `424242` code only work on dev) + `E2E_DATABASE_URL` (a **dedicated** Neon branch, never prod — the suite runs migrations + writes/purges rows).

**The unit gate is DB-FREE.** Never add a committed test that opens a DB connection. `vite.config.ts` `test.env` hands the Vitest worker a placeholder `DATABASE_URL` so that importing a module which transitively pulls in `src/lib/db` (eager `neon(process.env.DATABASE_URL!)`) doesn't throw when the var is unset in CI — it only constructs, never connects (no queries run). For DB-touching behaviour, write a throwaway `*.test.ts` run with `node -r dotenv/config node_modules/.bin/vitest run <file> dotenv_config_path=.env.local` and delete it before committing.

**Dependency hygiene.** Build-only tools (`vite`, `@tailwindcss/vite`, `tsx`, `esbuild`) live in **devDependencies** — otherwise their build-time advisories surface in the prod audit (`security.yml`). Vercel installs devDependencies during builds, so build plugins belong there.

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

# Transactional email via Resend (api/_lib/email.ts). OPTIONAL in dev — org
# invitations degrade to "copy the link", but self-serve ACCOUNT DELETION needs
# it (the email OTP is the gate; /api/account/delete/request-code 503s without).
RESEND_API_KEY=re_...                    # server-only
EMAIL_FROM="ProfitSync <noreply@profitsync.net>"  # verified sender; falls back to onboarding@resend.dev

# Platform admin bootstrap (OPTIONAL) — comma-separated emails that are ALWAYS
# super_admin without an app_admins row (api/_lib/admin.ts rootAdminEmails()).
# This is how the FIRST admin gets access in an environment whose DB was never
# seeded (prod Clerk user ids differ from dev, so dev seeds don't carry over).
ROOT_ADMIN_EMAILS=owner@example.com

# Web Push (notification system — OPTIONAL; push silently disabled if absent).
# Generate a keypair with: npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=B...                     # server
VAPID_PRIVATE_KEY=...                     # server-only — never expose to browser
VAPID_SUBJECT=mailto:support@profitsync.app
VITE_VAPID_PUBLIC_KEY=B...                # browser (same value as VAPID_PUBLIC_KEY)

# Native (Android/iOS) push via FCM HTTP v1 (OPTIONAL; the fcm channel silently
# no-ops if absent). Firebase service-account key: raw JSON or base64 of it.
# Setup: docs/native/ANDROID.md → "Push notifications (FCM)".
FCM_SERVICE_ACCOUNT_JSON=...              # server-only — never expose to browser

# Object storage for quotation PDFs (Hetzner Object Storage / MinIO / AWS S3;
# OPTIONAL — the PDF modal shows "not available" (503) if absent). These are the
# app's READ credentials; it mints a fresh short-lived (~1h) presigned URL on
# every view/download so shared links expire on their own. The Go worker holds
# the matching WRITE credentials under the SAME S3_* names (worker/deploy/.env)
# and uploads the bytes. Keep the bucket PRIVATE — the presigned URL from the
# authed, org-scoped GET /api/quotations/:id/pdf is the only path to the bytes.
# ⚠ SERVER-ONLY — never expose to the browser (no VITE_ prefix; the client only
#   ever receives a presigned URL, which carries a signature, not the key).
# Full architecture + ops: docs/quotation-pdf/SYSTEM.md.
S3_ENDPOINT=fsn1.your-objectstorage.com   # server-only — host, no scheme
S3_REGION=us-east-1                        # default us-east-1
S3_BUCKET=...                              # server-only — private bucket
S3_ACCESS_KEY=...                          # server-only — never expose to browser
S3_SECRET_KEY=...                          # server-only — never expose to browser
S3_USE_SSL=true                            # "false" for plain HTTP (dev only)
S3_FORCE_PATH_STYLE=true                   # true for Hetzner/MinIO; "false" = virtual-hosted
```

The `E2E_*` secrets (`E2E_VITE_CLERK_PUBLISHABLE_KEY`, `E2E_CLERK_SECRET_KEY`, `E2E_DATABASE_URL`) are **GitHub Actions secrets for the e2e workflow only** — they do **not** go in `.env.local` or Vercel. The two Clerk ones are your existing **dev**-instance keys (same `pk_test_…`/`sk_test_…` already in `.env.local`); `E2E_DATABASE_URL` is a dedicated Neon branch. Vercel manages the running app's env separately (`vercel env`; note: `vercel dev` reads the cloud Development env, not `.env.local`).

## Architecture

**Stack:** React 19 + TypeScript + Vite, Tailwind CSS v4 (via `@tailwindcss/vite` plugin — a **devDependency**, see *Dependency hygiene*), shadcn/ui (new-york style), react-router-dom v7, react-hook-form + zod, Clerk (auth), Neon (Postgres via Drizzle ORM), Vercel serverless functions (`api/` directory), recharts, i18next (8 locales), Vitest. **Motion/graph:** `tw-animate-css` + `@formkit/auto-animate` + `vaul` (drawers) + `@dnd-kit` (drag-to-reorder) for animation; **React Flow (`@xyflow/react`)** powers the money-flow node graph (`/flow`, lazy-loaded); `embla-carousel-react` for carousels.

**Path alias:** `@/` resolves to `src/`.

### Routing (`src/App.tsx`)

All pages are lazy-loaded (`React.lazy` + `Suspense`) for code splitting. Route groups:

| Group | Paths | Shell |
|---|---|---|
| Public legal | `/privacy-policy`, `/terms-of-service` | None |
| Public blog | `/blog`, `/blog/:slug` | None (marketing — reuses `src/landing/` design + isolated i18n) |
| Invitation | `/invitations/:token` | None (handles sign-in inline) |
| Auth | `/login/*`, `/signup/*`, `/forgot-password`, `/reset-password` | None (Clerk requires `/*` glob) |
| Admin | `/admin`, `/admin/users`, `/admin/organizations`, `/admin/organizations/:id`, `/admin/subscriptions`, `/admin/invoices`, `/admin/billing-attempts`, `/admin/plans`, `/admin/blog`, `/admin/referrals`, `/admin/admins` | `AdminLayout` |
| App | `/dashboard`, `/clients`, `/clients/closed`, `/clients/:id`, `/clients/:id/files`, `/transactions`, `/recurring`, `/calendar`, `/flow`, `/wealth`, `/wealth/:id`, `/analytics`, `/categories`, `/budgets`, `/budgets/:key`, `/referrals`, `/quotations`, `/organizations`, `/organizations/:id/members`, `/subscription`, `/trash`, `/profile`, `/onboarding`, `/organization-setup` | `AppLayout` |

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
| `Category` | `categories` | `organization_id`, per-org transaction category list (seeded on first access — re-seed only when empty, never on delete) |
| `WealthAccount` | `wealth_accounts` | `organization_id`, `type`: `cash\|bank`, `opening_balance`, `current_balance`, `is_default`, `archived_at`; `Cash` auto-provisioned + permanent |
| `RecurringRule` | `recurring_rules` | `organization_id`, anchor + frequency; lazily **materializes** due transactions on GETs (no cron). Tx carry `recurring_rule_id` |
| `Budget` / `BudgetHistory` | `budgets`, `budget_history` | per-client/own-company spend caps + adherence/creep history (keyed by org+client so it survives "remove") |
| `Subscription` attempt | `billing_attempts` | who clicked checkout, status, errors, admin follow-up (status/notes); see `subscription-system` skill |
| `Referral` family | `referrals`, `referral_codes`, `referral_settings`, `payout_requests` | credited on real paid upgrade (webhook AND reconcile); payouts via `/admin/payouts` |
| `AdminRole` | `admin_roles` | custom platform-admin roles — `key`, `capabilities` (jsonb, grantable set only); see *Platform-admin roles* |
| `AuditLog` | `audit_logs` | org action history (`/api/audit`) |

`CURRENCIES` (ISO code list) and `LEGAL_DOC_VERSION` are exported from `src/lib/types.ts`. The custom dashboard layout (rearrangeable/hideable cards, per personal/business context) lives in `user_profiles.dashboard_layout` (model: `src/lib/dashboard-layout.ts`).

**Drizzle helpers:**
- `db` and `serialize()` are in `src/lib/db/index.ts`. `serialize()` converts Drizzle's camelCase row keys to snake_case before `res.json()` — call it on every row returned from an API route.
- Migrations are in `drizzle/` and run automatically on `vercel-build` (`scripts/db-migrate.mjs`). Current head is **0052**. **Journal gotcha:** a new migration can silently skip ("up to date" but column missing) when `drizzle/meta/_journal.json` `when` values were normalized — bump the new entry's `when` above the previous, then verify the column exists in `information_schema`.

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
- **Caveat:** Vercel may serve static `dist/index.html` for `/` before the rewrite (filesystem precedence). The landing still carries Organization/WebSite/SoftwareApplication JSON-LD baked statically into `index.html` (now with the 1200×630 OG image, dimensions, `og:locale`, canonical), so it degrades gracefully; `/blog/*` and the rest have no static collision and always SSR. The `www`→apex redirect is **code** (308 in `vercel.json`, host-conditioned, with `/sw.js` + `/api/*` carve-outs) — the apex domain must have **NO dashboard-level redirect** in Vercel project settings. ⚠️ Never configure a dashboard redirect on either domain: a domain-level redirect strands every service worker registered on that host (SW script fetches reject redirects → the worker can never update or unregister, and keeps serving its frozen precache forever — the historical permanent-white-screen bug).

#### PWA / service worker (`pwa/`, `src/lib/pwa/`)

- The real worker is **`/app-sw.js`** (vite-plugin-pwa `filename`); **`/sw.js` is reserved** — a vercel.json rewrite serves `public/kill-sw.js` there, a self-destroying worker that rescues every legacy registration (old clients keep polling `/sw.js`, get the kill switch, purge caches, reload fresh, re-register `/app-sw.js`). Don't rename these paths.
- **App navigations are NetworkOnly** with `precacheFallback` to the precached shell (offline support): a cold load always gets the *current* `index.html`, so a stale-shell→missing-chunk white screen can't happen. Public pages (`/`, legal, blog, invitations, API) are denied to the SW entirely — `NAVIGATION_DENY_RE` in `pwa/sw-policy.ts` is the single source of truth (the same regex is **inlined** in `matchAppNavigation`; `sw-policy.test.ts` guards the sync — workbox stringifies the matcher into the worker, so it must stay closure-free).
- **`skipWaiting`/`clientsClaim` stay OFF.** A new SW installs and WAITS; `onNeedRefresh` shows the `<UpdatePrompt />` banner ("Update available" → `updateSW(true)` reloads onto the new version). Update checks run hourly + on `visibilitychange`. Never force-activate without a reload.
- Recovery ladder (shared `sessionStorage` budget across `chunk-recovery.ts`, the inline `index.html` script, and `AppErrorBoundary`): attempt 1 = cache-busted reload; attempts 2–3 = **also unregister all SWs + delete all caches** (the only escape from a zombie worker).
- **Chunking invariant (`vite.config.ts` `manualChunks`):** the chunk graph must stay acyclic — `flow` (@xyflow) → `charts` (recharts/d3) → `vendor` (everything else incl. React). A library landing in `vendor` while its dependency sits in a leaf chunk (e.g. @xyflow's d3-zoom) creates a `vendor↔leaf` cycle and a **total white screen** at boot (`forwardRef` of undefined). After touching chunking, verify: `grep -o 'charts-[^"]*\.js' dist/assets/vendor-*.js` must be empty.

#### Native apps (Capacitor) — Web ↔ Native parity

The Android (`android/`) and iOS (`ios/`) apps are **[Capacitor](https://capacitorjs.com) WebView shells around the exact same Vite build** (`capacitor.config.ts` `webDir: "dist"`). The copied bundle lives at `android/app/src/main/assets/public` and `ios/App/App/public` — both are **gitignored build artifacts**, not source. There is **no separate native UI codebase**: a change to the web bundle (UI, routes, assets, i18n, client logic) **is** the native change once the bundle is re-copied into the shells.

- **🔴 STRICT PARITY RULE — non-negotiable during development:** whenever a change affects the built web bundle, you MUST propagate it to **both** native apps **before the task is done**, and say so in the plan/PR. One command per platform: **`npm run cap:sync:android`** and **`npm run cap:sync:ios`** (each = a native-mode `vite build` + `cap sync`). This rule is also a *Key conventions* bullet — see there. Never land a web-UI change that leaves Android/iOS on a stale bundle.
- **`cap sync` vs `cap copy`:** `cap sync` = `cap copy` (web assets + config) **plus** `cap update` (native deps/plugins). Use the **`cap:sync:*` npm scripts** whenever a Capacitor **plugin** was added/updated. A plugin-free, web-assets-only change can use `npx cap copy android` / `npx cap copy ios` after a build — but when in doubt, **`cap:sync:*`**.
- **Native-mode builds matter:** `build:android` / `build:ios` (`vite build --mode android|ios`) wire native-only config (deep-link scheme `com.vorreix.profitsync://oauth-callback`, FCM stub alias, public keys). Don't point the native shells at a plain `npm run build` when a mode-specific env is involved — always go through `cap:sync:{android,ios}`.
- **Mobile-safety constraints every web change must keep** (they exist because the same DOM runs in the native WebView): ≥44 px touch targets, ≥16 px inputs (iOS avoids auto-zoom), safe-area insets (`src/index.css`), wide tables wrapped in `overflow-x-auto`, and **the page body never scrolls horizontally** (headers `flex-wrap` rather than overflow — see the Clients header).
- **Store is the only native update path** (the in-app service worker is disabled in the shell) — bump the version and re-upload for every shipped change. Full setup/ops: **`docs/native/README.md`** (+ `ANDROID.md` / `IOS.md` / `PUBLISHING.md`).

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

**Newer routes (Wave 4 / ux4):**

| Path | File / purpose |
|---|---|
| `/api/categories` · `/api/categories/:id` | per-org transaction category list (GET/POST · PATCH/DELETE) |
| `/api/wealth/accounts` (+ `/:id`, `/reorder`, `/:id/attachments`) | cash/bank accounts + running balance |
| `/api/wealth/transfer` | account-to-account transfer (`kind=transfer`; excluded from income/expense) |
| `/api/wealth/bank-search` · `/api/wealth/quota` | bank logo/name autocomplete · free-plan bank gating |
| `/api/recurring` · `/api/recurring/:id` | recurring rules (materialize lazily on GETs) |
| `/api/calendar` | per-day money aggregates (drives `/calendar`) |
| `/api/flow` | money-flow graph; `?mode=timeline&bucket=…` for the running-balance chain |
| `/api/budgets` · `/api/budgets/overview` · `/api/budgets/detail` | budgets + adherence/creep |
| `/api/analytics` · `/api/audit` | trend/category/client aggregates · org audit log |
| `/api/onboarding` | first-run setup (POST) |
| `/api/referrals` (+ `/apply`, `/payouts`) | referral program |
| `/api/search` | org-scoped global search (`?q=`, min 2 chars) — clients/transactions/quotations/wealth accounts/categories in one grouped payload; drives the ⌘K palette + mobile search overlay |
| `/api/transactions/group` · `/api/transactions/bulk-delete` | split groups · bulk delete |
| `/api/clients/bulk-delete` · `/api/clients/:id/media` | bulk delete · client logo |
| `/api/billing/change-plan` · `/resume` · `/invoices` · `/invoice-pdf` | self-serve billing |
| `/api/public/pricing` | geo pricing (no auth) |
| `/api/admin/roles` · `/api/admin/roles/:id` | custom admin roles (**super-admin only**) |
| `/api/admin/billing-attempts` (+ `/:id`) | checkout-attempt log + follow-up |
| `/api/admin/payouts` (+ `/:id`) · `/api/admin/referrals` · `/api/admin/referral-settings` | referral admin |
| `/api/admin/subscriptions/actions` · `/api/admin/organizations/bulk-delete` | bulk admin actions |
| `/api/account/delete/summary` · `/request-code` · `/confirm` | self-serve account deletion: consequences summary, email OTP (hash-only `account_deletion_codes`, mig 0053), confirm → `api/_lib/account-delete.ts` `deleteUserAccount()` (org teardown w/ Dodo cancel → user-scoped rows → profile → Clerk user LAST; admin user-delete uses the same helper) |
| `/api/trash/clear` | purge the org's whole trash (same balance/split-group invariants as single purge) |

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

### Platform-admin roles / RBAC (`src/lib/admin-roles.ts`, `api/_lib/admin.ts`)

`/admin` access is gated by **capabilities**, not the role name. A platform admin is an `app_admins` row whose `role` is a SYSTEM role (`super_admin | editor | viewer | blog_writer`) or the `key` of a CUSTOM role (`admin_roles` table, mig 0042). `requireAdminCap(req, res, cap)` returns `{ userId, role, caps, can }`; gate routes/UI off `can(cap)` / the server-resolved `caps`, **never** the role name (custom roles would break). The client uses `useAdmin().can(cap)` / `caps` (from `/api/admin/me`).

Capabilities: `read`, `write`, `blog`, `settings`, `manage_admins`, plus three **super-admin-EXCLUSIVE** ones excluded from `GRANTABLE_ADMIN_CAPS` — `org_transactions` (the org-detail Transactions tab + `/api/admin/transactions`), `manage_super_admins`, `manage_roles`. Custom-role capabilities are sanitized to the grantable set on **both write and read**, so a tampered row can't escalate. Visibility rule ("shouldn't even see it exists"): non-supers don't see the `super_admin` role in pickers, super-admin rows are redacted from their admins list, and the org Transactions tab is hidden. Enforcement is server-side everywhere; hiding is UX, the 403 is the security.

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
- **Web ↔ Native parity (STRICT — do not skip):** the Android + iOS apps are Capacitor shells around the **same `dist/` bundle**, so **every** web-UI / asset / route / i18n / client-logic change MUST be propagated to **both** native apps **before the task is considered done** — run `npm run cap:sync:android` **and** `npm run cap:sync:ios` (each = native-mode `vite build` + `cap sync`; `npx cap copy android/ios` is acceptable only for a plugin-free, web-assets-only change). Keep the mobile constraints (≥44 px targets, ≥16 px inputs, safe-area insets, no horizontal page scroll). A web change that leaves the native shells on a stale bundle is an incomplete task. Details: *Native apps (Capacitor) — Web ↔ Native parity* above.

## Product context

See `project_idea.md` for the full spec. Key domain concepts:

- **Organizations** are the central multi-tenancy unit. Every client, transaction, and quotation belongs to an org, not directly to a user. Each user gets a personal org on first login.
- **Clients** are the main entity. Status: `active | inactive | archived`. Support soft-delete (trash/restore/purge).
- **Transactions** (`incoming | outgoing`) belong to a client and drive financials. Support file attachments.
- **Quotations** (`draft | sent | accepted | rejected`) can be converted to clients via `/api/quotations/:id/convert`. Support file attachments.
- **Plans:** `free` (limited) and `premium` (Dodo Payments subscription). Limits are stored in the `plans` table and enforced server-side via `api/_lib/quota.ts`.
- **Wealth accounts** (`wealth_accounts`): per-org cash/bank accounts with a running balance; transactions post to an account, and **transfers** (`kind=transfer`) move money between accounts without counting as income/expense. Free plan is gated to one bank (golden crown + upgrade modal); `Cash` is auto-provisioned and permanent. ⚠️ A DB-direct transaction delete does **not** reverse wealth balances — recompute from the ledger.
- **Recurring rules** (`recurring_rules`): templates that **lazily materialize** due transactions on GETs (no cron) — anchor-based date math, race-proof; delete-is-final for occurrences (intentional).
- **Calendar** (`/calendar`) + **Money flow** (`/flow`, React Flow): visual views of transactions — a day/week/month money calendar (with per-day figures) and a node graph in two modes (grouped by account/client/category, or a running-balance **timeline** chain). Both org-scoped + filterable; canvas state persists across navigation (sessionStorage `ps_flow_<org>`).
- **Budgets** (`budgets` + `budget_history`): per-client / own-company spend caps with adherence + creep history (`/budgets`).
- **Referrals**: credited on a real **paid** upgrade (from BOTH the `payment.succeeded` webhook AND the reconcile path — activation never depends on webhooks), payouts approved in `/admin/payouts`. See `docs/referrals/REFERRALS.md`.
- **Admin console** (`/admin/**`) is restricted to `app_admins` rows; access is **capability-based** with system + custom roles (see *Platform-admin roles / RBAC* above). Seed the first admin via `scripts/seed-admin.ts`.
- **Currency** is set per-org. `useCurrency()` reads `activeOrg.currency` throughout the UI. Checkout charges in the org's currency (`src/lib/billing-currency.ts`; **India always INR**).
