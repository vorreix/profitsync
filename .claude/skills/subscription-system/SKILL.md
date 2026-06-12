---
name: subscription-system
description: Use when working on ProfitSync billing, subscriptions, plans, invoices, the Dodo Payments integration, webhooks, or the /admin subscription & organization panels — anything that creates, cancels, downgrades, deletes, syncs, or charges a subscription, or that touches the subscriptions/invoices/plans tables. Establishes the Dodo-is-money / DB-is-mirror model and the invariants that keep them in sync.
---

# ProfitSync Subscription & Payments System

The authoritative human explainer is `docs/billing/SUBSCRIPTIONS_AND_PAYMENTS.md` — read
it for the full picture. This skill is the **operating guide**: the mental model, the
invariants you must not break, where everything lives, and how to verify changes safely.

## Mental model (internalize this first)

- **Dodo Payments is the Merchant of Record** — it owns the money, the card, renewals,
  taxes, and invoices. **Dodo is authoritative for money.**
- **Our DB is a mirror.** `subscriptions` (one row per org) + `invoices` (one row per
  Dodo payment) are a local copy kept fresh by **webhooks** and **explicit reconcile**.
  The mirror is authoritative for **feature-gating**; when it disagrees with Dodo,
  **Dodo wins** (that's what "Sync from Dodo" / `reconcileSubscriptionFromDodo` does).
- **A real paid subscription is created ONLY by the user completing Dodo's hosted
  checkout.** Admins can't enter a card. So an **admin "upgrade" is a comp grant** (no
  Dodo sub, no charge); an **admin "downgrade/cancel" cancels on Dodo** and resets the
  mirror.

## Invariants — do not break these

1. **Admin plan/status changes must stay Dodo-aware.** Downgrading to free or cancelling
   MUST (a) cancel the Dodo subscription and (b) clear the stale mirror fields. Use the
   helpers in `api/_lib/admin-billing.ts`:
   - `stopDodoBilling(sub)` — immediate Dodo cancel; **no-op** for stub/manual/free;
     treats 404/already-gone as success; **never throws** (returns a result).
   - `FREE_RESET_FIELDS` — the clean free-tier column set (clears period, cycle,
     provider, cancel, scheduled-change). Spread with a fresh `updatedAt`.
   - `cancelledNowFields(now)` — mark cancelled immediately, keep the plan key.
   - Regression to avoid: writing `plan_key='free'` without clearing
     `current_period_end` leaves a stale **"Renews on …"** date (the original bug), and
     skipping `stopDodoBilling` leaves Dodo **active and still billing**.
2. **Fail loud on a single Dodo error; be resilient in bulk.** For a single action,
   return HTTP 502 with the DB **untouched** so the admin can retry (no silent desync).
   For bulk, process each row independently and report per-row outcomes.
3. **Invoices upsert idempotently** on `provider_invoice_id` (the Dodo payment id). A
   webhook retry or a concurrent reconcile must not create duplicate invoice rows.
4. **The Dodo environment is per-subscription.** Always resolve it with
   `dodoEnvForSub(sub)` (snapshot `dodo_environment`, else `defaultDodoEnv()`); never
   hardcode test/live. Cancel/sync/invoice must hit the env the sub was created in.
5. **Deleting an org must use `teardownOrganization()`** (`api/_lib/admin-org-delete.ts`).
   `clients` and `quotations` have **no `organization_id` FK**, so a bare org delete
   orphans them (+ transactions + attachments). Teardown also cancels the Dodo sub.
6. **Standard API rules still apply:** scope by `orgId` (admin routes are cross-org via
   `requireAdminCap`), `serialize(row)` before `res.json`, `.js` import extensions in
   `api/**`, capability check (`write`) before mutations.

## Statuses (memorize)

`subscriptions.status`: **`pending`** (checkout made, not paid) · **`active`** (paid &
current; also the free tier) · **`past_due`** (renewal failed / dunning) ·
**`cancelled`** (terminated) · **`trialing`** (reserved, unused).
Dodo→ours via `mapDodoStatus`: `on_hold`/`failed`→`past_due`, `cancelled`/`expired`→
`cancelled`, `active`→`active`, else `pending`.
`invoices.status`: `paid` · `uncollectible` (failed charge) · `void` (cancelled) ·
`open` (in-flight) · `draft`/`refunded`.

## Where things live

| Concern | File |
|---|---|
| Dodo REST client + webhook signature verify (incl. ±5min replay window) | `api/_lib/dodo.ts` |
| Billing-currency resolution chain (pure, tested) | `src/lib/billing-currency.ts` |
| Billing-attempt logger (non-fatal, transition-guarded) | `api/_lib/billing-attempts.ts` |
| Billing-attempt admin routes + page | `api/_routes/admin/billing-attempts*.ts`, `src/pages/admin/AdminBillingAttemptsPage.tsx` |
| Reconcile from Dodo (status/dates/invoices) | `api/_lib/billing-sync.ts` |
| Payment → invoice mapping (pure) | `api/_lib/invoice-map.ts` |
| Admin Dodo-aware helpers (cancel + free reset) | `api/_lib/admin-billing.ts` |
| Org teardown (cancel + delete + orphan cleanup) | `api/_lib/admin-org-delete.ts` |
| Webhook (its own Vercel fn, `bodyParser:false`) | `api/billing/webhook.ts` |
| Self-serve billing | `api/_routes/billing/{create-subscription,cancel,resume,change-plan,sync,invoices}.ts` |
| Admin orgs (+ bulk-delete) | `api/_routes/admin/organizations.ts`, `…/organizations/bulk-delete.ts` |
| Admin subscriptions (+ bulk actions) | `api/_routes/admin/subscriptions.ts`, `…/subscriptions/actions.ts` |
| Admin UI | `src/pages/admin/Admin{Orgs,Subscriptions,OrgDetail}Page.tsx` |
| Route registration | `api/index.ts` (static before dynamic at same depth) |
| Plans / limits / quota | `plans` table, `api/_routes/admin/plans.ts`, `api/_lib/quota.ts` |

The `/admin` console is intentionally **English-only (no i18n)** — admin UI strings do
NOT need locale files. (User-facing billing strings in `src/pages/SubscriptionPage.tsx`
DO go through i18n.)

## Common tasks

- **"Admin downgrade leaves a renew date / Dodo still active"** → ensure the route uses
  `stopDodoBilling` + `FREE_RESET_FIELDS` (see `admin/organizations.ts` and
  `admin/subscriptions.ts` PATCH branches; bulk in `subscriptions/actions.ts`).
- **"Record payment failures"** → handle `payment.failed` in the webhook (uncollectible
  invoice + `past_due`), as `payment.succeeded` does for `paid`.
- **"Reconcile a wrong-looking subscription"** → `reconcileSubscriptionFromDodo` (wired
  as the per-row + bulk **Sync from Dodo** action).
- **"Card payment fails abroad (e.g. India: 'Missing connector response')"** → Dodo routes
  a charge to a connector by **{billing country × currency}**. Our products are USD-priced,
  so `create-subscription` now derives **`billing_currency`** from the billing country
  (profile country → IP → US) via `currencyForCountry` (IN→INR) and passes it +
  the full billing address to `createSubscription` (`api/_lib/dodo.ts`). Do **not** set
  `allowed_payment_method_types` (a whitelist that *hides* valid methods elsewhere). The
  account must also have the region's connector/adaptive-currency enabled in the Dodo
  dashboard; test mode needs a matching-country test card. See
  `docs/billing/SUBSCRIPTIONS_AND_PAYMENTS.md` §11.
- **"A referral didn't flip to paid after a real upgrade"** → referral crediting
  (`creditReferralOnPaid`) runs from BOTH the `payment.succeeded` webhook AND the reconcile
  path (`reconcileInvoices` in `billing-sync.ts`) — because activation never depends on
  webhooks. It's idempotent (`signed_up → paid`, status-guarded). "Sync from Dodo" on the
  org back-fills any historical case. Earnings unlock after `referral_settings.holding_days`
  (default 14; admins can lower it to test). Full lifecycle: `docs/referrals/REFERRALS.md`.
- **Add an admin bulk endpoint** → new file under `api/_routes/admin/<x>/<action>.ts`,
  register in `api/index.ts`, `requireAdminCap(req,res,"write")`, process ids
  independently, return per-row results; UI uses `useMultiSelect()` + a `Checkbox`
  column + a bulk bar + optimistic in-place row updates.

## Billing currency (ux4)

Checkout charges in the **organization's currency** when Dodo can route it.
`resolveBillingCurrency(orgCurrency, billingCountry)` (src/lib/billing-currency.ts,
unit-tested) implements the chain:

1. org currency == country currency → use it
2. billing country **IN → ALWAYS INR** (the Indian-card/UPI connector failure
   happens at PAYMENT time on the hosted page — a create-time retry cannot save
   it, so the org preference must never override India)
3. org currency ∈ DODO_SUPPORTED_CURRENCIES → use it
4. else country currency (→ USD fallback)

`create-subscription` walks `billingCurrencyAttempts()` (resolved → country →
omit) retrying on Dodo errors — a currency preference can never fail checkout.
The used value is SNAPSHOTTED on `subscriptions.billing_currency` (cleared by
`FREE_RESET_FIELDS` + the self-serve free switch); `invoices.currency` stays
authoritative for what was actually charged. Per Dodo docs: `billing_currency`
is honored only when Adaptive Currency is enabled on the merchant account
(ignored otherwise — harmless), unsupported currencies fail the create call.

## Billing attempts (observability, ux4)

Every paid-plan subscribe click logs a `billing_attempts` row:
`created → redirected → completed | failed` (stale in-flight rows DISPLAY as
`abandoned` after 24h — derived at read time, no mutation job). Rules:

- **Logging is non-fatal** (audit pattern): a logging failure must never break
  the money path. All writes go through `api/_lib/billing-attempts.ts`.
- **Transitions are guarded** (`canTransition`): idempotent webhook retries
  can't regress a status; only `failed → completed` may leave a terminal state
  (payment retry / dunning recovery).
- **Linking precedence**: `metadata.attempt_id` (we put it in the Dodo checkout
  metadata) → newest attempt by `dodo_subscription_id` → newest for the org.
- Logging points: create-subscription (created/redirected/failed + error
  message), stub activation, webhook payment.succeeded/failed +
  subscription.active, and the return-from-checkout sync reconcile.
- Admin page `/admin/billing-attempts`: funnel chips + filters + detail dialog
  (raw payment.failed payload) + follow-up status/notes
  (`none|contacted|resolved|paid_later`). English-only like the rest of /admin.

## Verifying changes (critical)

- **The pre-commit gate (`i18n → lint → typecheck → test:ci`) is DB-FREE.** NEVER add a
  test that opens a DB connection to the committed suite. Pure logic only:
  `admin-billing.test.ts`, `invoice-map.test.ts`, `dodo.test.ts`.
- To prove DB-touching behaviour, write a **throwaway** `*.test.ts`, run it with
  `node -r dotenv/config node_modules/.bin/vitest run <file> dotenv_config_path=.env.local`,
  then **delete it before committing**. Seed clearly-marked rows (slug `zzz-…`) and
  clean them up in `afterAll`.
- **Never run a real Dodo cancel against the shared dev/test subscriptions.** Use a
  `provider: 'stub'` row (so `stopDodoBilling` no-ops), or mock `fetch`/`cancelSubscription`.
  To exercise a route handler, you can `vi.mock("../../../_lib/admin.js")` to stub
  `requireAdminCap` and call the exported handler with a fake `{method,body,query}` /
  res object.
- Run the gate before every commit; commits are stacked feature branches off `dev`.

## Gotchas

- Dodo's PATCH cancel: `{ status: "cancelled" }` = **immediate**;
  `{ cancel_at_next_billing_date: true }` = **end of period**. Self-serve cancel uses
  end-of-period; admin uses immediate (so Dodo stops showing "active" now).
- `mapDodoStatus`/`statusForEvent` don't emit `trialing` — it's unused.
- The webhook is best-effort; activation/reconcile never depends on it (return-from-
  checkout `sync` + admin "Sync from Dodo" cover the same ground via REST).
- `verifyWebhookSignature` now also enforces a ±5 minute timestamp freshness
  window (Standard Webhooks) — fixed-timestamp tests must pass a matching `now`.
- The committed gate also runs a staged-diff secret scan first, and PRs to main
  run the Playwright e2e suite (.github/workflows/e2e.yml) — billing changes
  should keep the subscription-page smoke test green.
