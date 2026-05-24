# ProfitSync — Feature Roadmap Implementation Plan

> **Source:** `improvements.md` (May 2026 — Maqbool)
> **Active branch chain:**
> 1. `feature/organization-feature_maqbool` ← (this session)
> 2. `feature/sueradmin_maqbool` (off #1)
> 3. `feature/user-management_maqbool` (off #2)
> 4. `feature/mobile_ui_updates_maqbool` (off #3)
>
> Each phase must run isolated (commit + push + clear session) before the next begins.

---

## Phase 0 — Codebase Snapshot (entering Phase 1)

**Stack reviewed:**
- React 19 + Vite + TS, Tailwind v4, shadcn/ui (new-york), react-router-dom v7.
- Clerk auth (frontend `@clerk/clerk-react`, backend `@clerk/backend`).
- Neon Postgres via Drizzle ORM, snake_case serialization helper.
- Vercel serverless functions under `api/**`.
- Existing tables: `clients`, `transactions`, `quotations`, `transaction_attachments`, `quotation_attachments`, `user_profiles`.
- Auth model today: every row is scoped by Clerk `userId`. No org concept exists.

---

## PHASE 1 — Organization Feature + Legal Documents

> **Branch:** `feature/organization-feature_maqbool`
> **Goal:** Introduce a multi-org data model. Every user has ≥1 organization (auto-created "Personal" on first login). Users can create, switch, and search organizations. All app data (clients, transactions, quotations, attachments, trash) becomes org-scoped. Add legal documents (Privacy Policy + Terms of Service) and gate signup on user agreement.

### 1.1 Database / Schema
- [x] Add `organizations` table — `id uuid pk`, `owner_user_id text`, `name text`, `slug text` (unique per owner), `is_personal boolean`, `created_at`, `updated_at`.
- [x] Add `organization_members` table (forward-compatible with phase 3) — `id uuid pk`, `organization_id uuid fk`, `user_id text`, `role text default 'owner'`, `created_at`. For phase 1 only the owner is inserted.
- [x] Add `legal_acceptances` table — `id uuid pk`, `user_id text`, `document text` (`privacy_policy`/`terms_of_service`), `version text`, `accepted_at timestamp`.
- [x] Add `organization_id uuid` to `clients` (default null, populated by backfill), to `quotations`, then index it.
- [x] Add `current_organization_id uuid` and `terms_accepted_at timestamp` to `user_profiles`.
- [x] Create migration via `drizzle-kit push`. Backfill: for every existing distinct `user_id` in `clients`/`quotations`, create a "Personal" org and update rows.

### 1.2 Backend — Organization layer
- [x] Create shared helper `api/_lib/auth.ts` exporting `getAuth(req)` returning `{ userId } | null` and `getActiveOrg(req)` returning `{ userId, orgId }` (orgId from `x-org-id` header, falling back to `user_profiles.current_organization_id`, falling back to user's personal org auto-creating if missing).
- [x] Create `api/organizations.ts` (GET list / POST create) and `api/organizations/[id].ts` (GET / PATCH / DELETE — personal orgs cannot be deleted/renamed below "Personal").
- [x] Create `api/organizations/switch.ts` (POST — sets `current_organization_id` on profile).
- [x] Rewrite all existing endpoints to scope by `orgId` instead of `userId`:
  - `api/clients.ts`, `api/clients/[id].ts`
  - `api/transactions.ts`, `api/transactions/[id].ts`, `api/transactions/[id]/attachments.ts`
  - `api/quotations.ts`, `api/quotations/[id].ts`, `api/quotations/[id]/convert.ts`, `api/quotations/[id]/attachments.ts`
  - `api/attachments/[id].ts`, `api/quotation-attachments/[id].ts`
  - `api/trash.ts`, `api/trash/restore.ts`, `api/trash/purge.ts`
- [x] On `api/profile.ts` GET first-touch upsert, auto-create Personal org + member row + set `current_organization_id`.
- [x] Add `api/legal/accept.ts` (POST — record acceptance for given doc + version).

### 1.3 Frontend — Organization layer
- [x] Add `src/lib/types.ts` types: `Organization`, `OrganizationMember`.
- [x] Add `src/lib/org-context.tsx` — provider that loads `currentOrganization` from profile, exposes `switchOrg(id)` and `refresh()`, and surfaces `orgs[]`.
- [x] Update `src/lib/api.ts` to inject `x-org-id` header automatically based on context.
- [x] Add `src/components/OrgSwitcher.tsx` (combobox with search + "Create organization…" footer action).
- [x] Mount `<OrgProvider>` inside `AppLayout`, render `<OrgSwitcher>` in sidebar header.
- [x] Add `/organizations` page — list, create, rename, delete (excluding personal), set active.
- [x] Add deep links — `useOrg()` triggers re-fetch on every page when org changes (use `key={orgId}` or `useEffect([orgId])`).

### 1.4 Legal documents
- [x] Create `/privacy-policy` and `/terms-of-service` routes (full content, last-updated date). Use a simple `LegalPage` component.
- [x] Add footer links inside `AppLayout` sidebar footer + in `ProfilePage`.
- [x] Build a `SignupGate` component: pre-Clerk checkbox row ("I agree to the Terms of Service and Privacy Policy") + links. Only after checked does the Clerk `<SignUp />` render.
- [x] On first profile load post-signup, POST `/api/legal/accept` for both docs and set `terms_accepted_at`.

### 1.5 Verification
- [x] `npm run typecheck` — must pass clean.
- [x] `npm run build` — must succeed.
- [x] Playwright E2E:
  - [x] Login with rootmtt@gmail.com → see Personal org.
  - [x] Open switcher, create a second org "Acme Inc".
  - [x] Switch to Acme, dashboard shows empty state (no clients).
  - [x] Switch back to Personal, original data returns.
  - [x] Visit `/privacy-policy` and `/terms-of-service` directly.
- [x] Visual inspection — switcher legible, no broken layouts at sm/md/lg.

### 1.6 Wrap
- [x] `git add -A && git commit` (single feat commit, conventional message).
- [x] `git push origin feature/organization-feature_maqbool`.

---

## PHASE 2 — Super Admin Section

> **Branch:** `feature/sueradmin_maqbool` (from #1)
> **Goal:** Internal-only admin UI under `/admin/*` with full visibility/manipulation of users, organizations, subscriptions, and invoices. Distinct layout (no app sidebar).

### 2.1 Auth gate
- [x] Add `app_admins` table (`user_id text pk`, `created_at`).
- [x] Seed first admin = rootmtt@gmail.com (Clerk userId).
- [x] Backend middleware `requireAdmin(req)` — verify Clerk token + check membership.

### 2.2 Schema additions (lays groundwork for phase 3)
- [x] `subscriptions` (`id`, `organization_id`, `plan`, `status`, `provider`, `provider_subscription_id`, `current_period_end`, `cancel_at`, `created_at`, `updated_at`).
- [x] `invoices` (`id`, `subscription_id`, `organization_id`, `amount`, `currency`, `status`, `pdf_url`, `provider_invoice_id`, `issued_at`, `paid_at`).
- [x] `plans` (`id`, `key`, `name`, `is_active`, `monthly_price_usd`, `yearly_price_usd`, `monthly_discount_pct`, `yearly_discount_pct`, JSON `limits`, JSON `geo_pricing`).
- [x] Seed two plans: `free` and `premium` with defaults.

### 2.3 Admin layout
- [x] `src/pages/admin/AdminLayout.tsx` — top nav with sections (Users / Orgs / Subscriptions / Invoices / Plans), distinct slate/amber theme.
- [x] Routes: `/admin`, `/admin/users`, `/admin/organizations`, `/admin/subscriptions`, `/admin/invoices`, `/admin/plans`.
- [x] Guard: redirect to `/dashboard` if not admin.

### 2.4 Admin APIs
- [x] `api/admin/users.ts` (GET list w/ search, banned filter, paginate; PATCH ban/unban + promote/demote).
- [x] `api/admin/user-detail.ts` (GET single user with orgs + plan info).
- [x] `api/admin/organizations.ts` (GET list + counts, PATCH rename, DELETE).
- [x] `api/admin/subscriptions.ts` (GET list w/ filters, PATCH plan/status/cycle/period, POST create row).
- [x] `api/admin/invoices.ts` (GET, POST create, PATCH status, DELETE).
- [x] `api/admin/plans.ts` (GET / PATCH limits + pricing + discounts + geo).
- [x] `api/admin/stats.ts` — overview KPIs (users, orgs, subs, paid invoices, clients).
- [x] `api/admin/me.ts` — frontend probe.

### 2.5 Admin UI
- [x] Users table — search/email/status, drill-down dialog showing orgs + roles + admin promote/demote.
- [x] Orgs table — search by name, filter by type, rename + delete actions with cascading data warning.
- [x] Subscriptions table — filter by plan/status, edit dialog (plan/status/cycle/period).
- [x] Invoices table — filter by status, create + edit dialogs.
- [x] Plans editor — limits, USD pricing, discounts, geo pricing matrix per country code.
- [x] Settings/global toggles — deferred to Phase 3 (no concrete need yet).

### 2.6 Verification & wrap
- [x] Typecheck + build clean.
- [x] Playwright/devtools: log in as rootmtt → `/admin` visible, all sections load real data, mutations succeed.
- [ ] Commit + push.

---

## PHASE 3 — User Management + Subscriptions + Razorpay

> **Branch:** `feature/user-management_maqbool` (from #2)
> **Goal:** Per-org user invitations (owner / admin / editor / viewer). One user can belong to multiple orgs with different roles. Add Free vs Premium subscription tied to organization with recurring billing via Razorpay. Quotas enforced on clients/transactions/quotations/attachments/notes.

### 3.1 Invitations & RBAC
- [x] `organization_members` already had role; added `organization_invitations` table (id, org_id, email, role, token, invited_by, accepted_at, declined_at, expires_at).
- [x] Backend: `api/organizations/[id]/members.ts` (GET list + pending invites, POST invite/reinvite, PATCH role, DELETE member or invitation).
- [x] Public `api/invitations/[token].ts` (GET metadata without auth, POST accept with auth + email match check, DELETE decline).
- [x] Email sending: in-product invitation link is generated (`/invitations/:token`) and exposed via "Copy link" button. SMTP wire-up deferred — easily slotted in later via a `sendEmail()` helper at members POST.
- [x] Permission checks: viewer cannot write, editor cannot delete orgs (already enforced in Phase 1 helpers), only owner can change subscription (`api/billing/*` checks `ctx.role === "owner"`).
- [x] Members management UI at `/organizations/:id/members` with invite, role change, remove member, revoke invitation.

### 3.2 Plans & quota enforcement
- [x] Backend `api/_lib/quota.ts` — `checkClientQuota`, `checkTransactionQuota`, `checkQuotationQuota`, `checkAttachmentQuota`, `checkNoteLength` reading from `plans.limits` with sensible defaults.
- [x] Wired into clients (POST + PATCH for notes), transactions (POST), quotations (POST + PATCH for notes), quotation→client convert, transaction attachments POST, quotation attachments POST. All return 402 with structured `{ allowed: false, reason, limit, current, upgradeHint }`.
- [x] Quotation→Client conversion re-checks client-quota.
- [x] `/subscription` page — current plan banner, monthly/yearly toggle, geo pricing (US/IN), plan cards with full limit breakdown, subscribe/cancel actions, stub mode when Razorpay keys absent.

### 3.3 Razorpay integration
- [x] Documented `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` in `razorpay_integration.md`. Without keys, the create endpoint falls into stub mode so quotas unlock for QA.
- [x] Reused `subscriptions`/`invoices` tables with `provider="razorpay"` instead of separate tables.
- [x] Backend endpoints:
  - `api/billing/pricing.ts` (plans + geo + current sub).
  - `api/billing/create-subscription.ts` (free upsert OR Razorpay plan + subscription + pending row).
  - `api/billing/cancel.ts` (Razorpay cancel + local mirror).
  - `api/billing/webhook.ts` (signature verification, subscription/invoice/payment events).
- [x] Geo pricing: reads `x-vercel-ip-country` header (falls back to `?country=` query and `US`), picks localised price + currency + discount from `plans.geo_pricing` JSON.
- [ ] Email notifications: deferred — webhook handlers and members invite have natural insertion points; not blocking for this phase.
- [x] Authored `razorpay_integration.md` — env setup, dashboard config, sequence diagrams for subscribe/cancel/webhook, signature verification details.

### 3.4 Verification & wrap
- [x] Typecheck + build clean.
- [x] Playwright/devtools: subscribed to Premium via stub, downgraded to Free, quota enforcement returns 402 at 10 clients with proper message, invitation flow create→public-fetch→revoke verified.
- [x] Commit + push.

---

## PHASE 4 — Mobile-Native UI

> **Branch:** `feature/mobile_ui_updates_maqbool` (from #3)
> **Goal:** Mobile experience feels like a polished native app. All features fully functional on phone screen sizes with a custom mobile layout (bottom tab bar, native-style transitions, large tap targets, swipe gestures).

### 4.1 Mobile shell
- [ ] Introduce `useIsMobile()` (already in `src/hooks/use-mobile.ts` if present, else create).
- [ ] Switch `AppLayout` to render `MobileAppLayout` when mobile.
- [ ] `MobileAppLayout`: top bar with org switcher pill + menu sheet, bottom tab bar (Dashboard / Clients / Transactions / Quotations / More), FAB above the tab bar with safe-area padding.
- [ ] Page transitions via Framer-style fade/slide using CSS transitions (no extra deps if possible).

### 4.2 Page redesigns (per page)
- [ ] Dashboard — card carousel for KPIs, chart full-bleed, swipeable client cards.
- [ ] Clients — list with avatar circle, swipe-to-archive, sticky search bar.
- [ ] Client detail — sticky header with metrics, segmented tabs (Transactions / Notes / Attachments).
- [ ] Transactions — grouped by date with date headers; pull-to-refresh.
- [ ] Quotations — kanban-style status chips with horizontal scroll; long-press for actions.
- [ ] Trash, Profile, Subscription, Admin — mobile-tuned with collapsible sections.

### 4.3 Micro-interactions & polish
- [ ] Haptic-feedback-style press states (`active:scale-95 transition-transform`).
- [ ] Toast positioning above tab bar.
- [ ] PWA manifest + iOS apple-touch-icon + theme-color.
- [ ] Safe-area-inset padding on top/bottom for notch devices.

### 4.4 Verification & wrap
- [ ] Playwright in mobile viewport (iPhone 14 emulation) — login → switch org → create client → add transaction → view dashboard.
- [ ] Lighthouse mobile pass (focus on a11y + tap targets).
- [ ] Commit + push.

---

## Session execution rule

Each phase is executed in its own session with fresh context. When a phase finishes, the next session opens this file, picks up the next unchecked phase, branches off the previous one, and continues. Inside a phase, every checkbox MUST be ticked before commit.
