# Subscription & Billing Fixes — Design

**Date:** 2026-06-02
**Status:** Implementing (user authorized autonomous execution)

## Problems (reported)

1. **Desktop shows "Free" for paid orgs.** Sidebar (`OrgSwitcher`) and `OrganizationsPage`
   check `plan_key === "premium"`, but plan keys are now `free | personal | business`
   (premium is legacy). Mobile uses `plan_key !== "free"` and works. → desktop always "Free".

2. **Billing dates incomplete/confusing.** Only one date ("Renews") is shown. Users can't tell
   the start of the period from the renewal. Need BOTH a start date and the next-renewal date,
   sourced from Dodo (`previous_billing_date` / `next_billing_date`).

3. **Invoices always empty.** Invoice rows are created ONLY by the `payment.succeeded` webhook.
   The TEST webhook secret isn't configured on prod, so no rows are ever written even after a
   successful payment. → "No invoices yet" forever.

4. **Subscribed-state subscription page is wrong.** When already Pro it still shows the two plan
   cards. It should show a current-plan **banner** with a **Cancel** action (no refunds; access
   continues until the renewal date, then auto-cancels — clearly messaged), and a **monthly→yearly
   upgrade** option that takes effect at the next renewal (pay yearly then, no charge today).

5. **Monthly/Yearly toggle is weak.** Needs to be prominent and show a "Save X%" badge on yearly.

## Evidence (Dodo TEST API, probed live)

- `GET /subscriptions` item → `created_at`, `previous_billing_date`, `next_billing_date`,
  `cancel_at_next_billing_date`, `cancelled_at`, `scheduled_change`, `metadata{organization_id,plan_key,billing_cycle}`.
- `GET /payments?subscription_id=<id>` → `payment_id`, `status`, `total_amount` (minor), `currency`,
  `created_at`, `invoice_id`, `invoice_url`. **200 OK** — lets us populate invoices without webhooks.
- `GET /invoices/payments/{payment_id}` (Accept: application/pdf) → **200**, valid `%PDF` (53 KB).
- `POST /subscriptions/{id}/change-plan` supports `effective_at: "next_billing_date"` +
  `proration_billing_mode: "do_not_bill"` → schedule monthly→yearly at next renewal, no charge today.
  Result surfaces in `scheduled_change { product_id, product_name, effective_at }`.

## Changes

### Schema (`drizzle/0011`)
`subscriptions` add:
- `current_period_start timestamp` — Dodo `previous_billing_date` (start of current period).
- `scheduled_change jsonb` (nullable) — `{ billing_cycle, product_id, effective_at }` for a pending switch.

### `api/_lib/dodo.ts`
- Extend `DodoSubscription` with `created_at`, `scheduled_change`.
- `DodoPayment` type + `listPayments(subscriptionId, env)` → `GET /payments?subscription_id=`.
- `changePlan({subscriptionId, productId, quantity, prorationBillingMode, effectiveAt, metadata, env})`.

### `api/_lib/billing-sync.ts` (new, shared)
`reconcileInvoices(sub, env)` — list succeeded payments for the subscription and upsert invoice rows
(idempotent by `provider_invoice_id = payment_id`). Used by `sync` and the webhook.

### `api/_routes/billing/sync.ts`
Set `currentPeriodStart` (previous_billing_date), capture `scheduledChange`, then call
`reconcileInvoices`. So returning from checkout populates dates + invoices immediately.

### `api/_routes/billing/change-plan.ts` (new) + register in `api/index.ts`
POST `{ cycle }` — owner only. Resolve the org's active dodo subscription, get the plan's product id
for the target cycle, call Dodo change-plan (`effective_at: next_billing_date`,
`proration_billing_mode: do_not_bill`), re-sync to store `scheduledChange`.

### `api/billing/webhook.ts`
Also set `currentPeriodStart` from payload when present; clear/refresh `scheduledChange` on
`plan_changed`/`renewed`; call `reconcileInvoices` on `payment.succeeded` (reuse helper).

### Frontend
- `src/lib/types.ts`: add `isPaidPlanKey(key)` helper; extend `Subscription` shape consumers.
- `OrgSwitcher.tsx`, `OrganizationsPage.tsx`: use `isPaidPlanKey`, i18n labels.
- `SubscriptionPage.tsx`: two clear states —
  - **Not subscribed**: prominent segmented cycle toggle with "Save X%" on yearly + plan cards.
  - **Subscribed (active or cancelling)**: current-plan banner (name, status, started, renews/access-until,
    cycle, secured-by), Cancel (no-refund confirm), monthly→yearly upgrade block (or "Switching to
    Yearly on <date>" when scheduled). Billing & payments (dates + invoices) below.

### i18n
Add keys to `en.json` (subscription ns) and propagate to all 8 locales.

## Review-driven additions (admin plan-model cleanup)

An adversarial review surfaced that the earlier `premium` → `personal`/`business` plan-model
migration was left incomplete in the **admin** surface (pre-existing, same domain). Fixed:
- `isPaidPlanKey()` used for paid detection/badges in AdminOrgsPage, AdminOrgDetailPage,
  AdminSubscriptionsPage, AdminUsersPage (were `=== "premium"`, so paid orgs looked free).
- Admin "grant paid" toggles wrote the non-existent `premium` key → now toggle paid↔free and,
  when granting, pick the plan matching the org's `account_type` (threaded `account_type` through
  the admin organizations GET / org-detail). PLAN_OPTIONS now `free|personal|business`.
- Validation widened: `VALID_PLANS = free|personal|business|premium` (premium kept for legacy
  rows); admin organizations PATCH type widened.
- Admin metrics counted only `plan_key = 'premium'` (→ 0 paying customers). Now count any
  non-free active plan (`stats.ts`, `users.ts`).

Also fixed in my new code: `change-plan.ts` env fallback uses `defaultDodoEnv()` (not hardcoded
`live`); `sync.ts` query `.limit(1)`; webhook invoice insert sets `issuedAt` from the payment's
`created_at` (so a later reconcile doesn't rewrite it).

## Follow-up fixes (round 2)

- **Duplicate invoices.** Returning from checkout fired two concurrent reconciles (mount `load()`
  + the `?dodo=return` sync), each doing check-then-insert with no unique constraint → two invoice
  rows for one payment (observed 9–34 ms apart). Fix: unique index on `invoices.provider_invoice_id`
  (NULLs distinct, so non-Dodo invoices are unaffected) + atomic `onConflictDoUpdate` in both
  `reconcileInvoices` and the webhook; `migration 0012` dedupes existing rows then adds the index;
  `SubscriptionPage` skips the mount load on the return path. Verified: 2 concurrent reconciles → 1 row.
- **change-plan 502 → immediate charge (requirement change).** The monthly→yearly switch now happens
  **immediately and charges the yearly price now** (per updated requirement), instead of scheduling at
  the next renewal. Uses `effective_at: immediately` + `proration_billing_mode: full_immediately`.
  Important Dodo behaviours found and handled:
  - A sub can hold only one pending change → `409 SCHEDULED_PLAN_CHANGE_EXISTS`. The route calls
    `cancelScheduledChange` (DELETE `/subscriptions/{id}/change-plan/scheduled`, 404 = no-op) first.
  - The upgrade charge is created **asynchronously** (~3–5 s). The route polls `listPayments` (up to
    ~12 s) for the new payment before reconciling, so the invoice is present when the response returns;
    the self-healing invoices GET is the fallback. Empirically verified on a real TEST sub: switch →
    yearly product, next billing +1 year, **$49 yearly charge created**, reconcile → yearly invoice
    appears alongside the prior monthly one. UI messaging updated to "charged now / immediate".
  - (The earlier `next_billing_date` + `do_not_bill` design 422'd; `next_billing_date` only accepts
    `full_immediately`. Superseded by the immediate-charge requirement above.)

## Cancellation rework (round 3)

- **Bug:** cancel set `status: "cancelled"` immediately, but Dodo keeps the sub **active** until period
  end (cancel-at-next-billing). So the org instantly lost Pro (sidebar → Free, features gated) despite
  still having paid access. Fix: cancel now keeps `status` active and records `cancel_at` = period end
  (`cancelledAt` only set when actually terminated). The org keeps its plan + features until the date.
- **Note after cancelling:** a toast ("will cancel on {{date}} — you keep full access until then") plus a
  persistent amber notice in the banner with the access-until date. The edge case (monthly → upgrade to
  yearly → cancel) is handled: after the immediate upgrade the sub IS yearly, so cancel ends at the
  **yearly** period end.
- **Resume:** new `POST /api/billing/resume` → Dodo `cancel_at_next_billing_date: false`
  (`resumeSubscription`); UI shows a "Resume subscription" button while cancelling. Verified the full
  cancel → resume cycle against a real TEST sub (stays active throughout) and in the browser.
- **Proper confirmation UI:** replaced all `window.confirm` with a shadcn `AlertDialog` (cancel + switch
  confirmations) — verified rendering in the browser.

## Verification
- `npm run typecheck`, `npm run lint`, `npm run test:ci` (43 tests incl. new invoice-map + isPaidPlanKey).
- Live integration script against Dodo TEST: `getSubscription` (period start/end) + `listPayments`
  → invoice mapping for the real active business sub.
- End-to-end reconcile against local DB + real Dodo TEST sub: pending→active, dates populated
  (start Jun 1, renews Jul 1), invoice (€4.29 paid) created, then cleaned up.
- Browser smoke test (Playwright) of `/subscription`: free state (toggle + cards), yearly toggle
  (Save 20% badge + yearly price), and the subscribed manage view (banner, both dates, cancel
  no-refund note, monthly→yearly upgrade, invoice row) — all rendered correctly (Italian locale).
  Sidebar correctly flipped Gratis → PRO for the paid org.
- Adversarial review workflow over the diff (10 findings confirmed and addressed).
