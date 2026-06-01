# Per-plan Dodo Payments environment (test / live)

**Date:** 2026-06-01
**Status:** Design — awaiting review

## Problem

`GET /api/admin/plans` preview against production returns `Dodo 404 NOT_FOUND` for product
IDs `pdt_0Ng3n6hjzsZL1pSV4iwqA` / `pdt_0Ng3nZ2Dqp08HiIB7dcnE`.

**Root cause (verified, not a code bug):** the Dodo environment is a single module-level
constant in `api/_lib/dodo.ts:14-15`, derived from `DODO_PAYMENTS_ENVIRONMENT`. Production runs
`live_mode` with a live API key, so `getProduct()` queries `live.dodopayments.com`. Those product
IDs are **test** products and exist only on `test.dodopayments.com`. Dodo's environments are fully
sealed:

| Call | Result |
|---|---|
| `test.dodopayments.com/products/{id}` + test key | **200** |
| `live.dodopayments.com/products/{id}` + test key | **401** (test key rejected by live) |
| `live.dodopayments.com/products/{id}` + live key (prod today) | **404 NOT_FOUND** (product not in live) |

A test product ID can never resolve against the live API — even with code routing, because the
deployment's live key gets `401` at the test endpoint. The only fix is to query the **right
environment with the matching key**.

## Goal

Make the Dodo environment a **per-plan** property instead of a single deployment-wide constant, so
a test plan and a live plan can coexist in one deployment. Admins choose the environment in the
existing "Sync from Dodo" wizard; everything downstream (preview, checkout, cancel, sync, invoice,
webhook) uses the correct environment + credentials.

### Requirements (from product owner)

1. Everything is admin-managed (already true for plans).
2. Free plan stays undeletable (already enforced — DB trigger + API guard; **unchanged**).
3. The "Sync from Dodo" wizard: after picking **personal/business** (step 1), a **Test/Live toggle**
   appears at the bottom (default **Live**), then Continue → enter monthly/yearly product IDs →
   Sync. Sync/derive pulls product details from whichever environment the toggle selects.
4. Active/deactivate per plan drives what end-users see on the subscription page (**already works**
   via `isActive`; `pricing.ts:34` filters it — **no change needed**).

### Model decision

**One plan row per tier (key = account type), with a per-plan environment field.** This keeps the
existing architecture (`AdminPlansPage` upserts one plan per account type; `SubscriptionPage` shows
one paid plan per tier; `key` is unique). To go from testing to live, the admin re-runs the wizard
(or edits inline) and flips the toggle. *No new keying scheme, no SubscriptionPage changes.*

## Architecture

The environment becomes an explicit `DodoEnv = "test" | "live"` value threaded as a parameter
through every Dodo client function — never a mutable global (safe under Fluid Compute's concurrent
instance reuse). Its source of truth:

- **Preview/derive (admin):** the wizard/inline toggle → request body → `previewFromDodo(..., env)`.
- **Plan row:** `plans.dodo_environment` persists the admin's choice.
- **Checkout:** `create-subscription` reads `plan.dodo_environment`, uses it, and **snapshots** it
  onto the subscription.
- **Cancel / sync:** read `subscription.dodo_environment`.
- **Invoice PDF:** `invoice → subscription.dodo_environment`.
- **Webhook:** Dodo doesn't announce its env, so verification tries **both** signing secrets and
  reports which matched; that env self-heals any legacy subscription whose `dodo_environment` is null.

Legacy null/absent subscription envs fall back to `defaultDodoEnv()` — the deployment's
`DODO_PAYMENTS_ENVIRONMENT` (live_mode→live, else test) — not a hardcoded `"live"`, so a `test_mode`
deployment's pre-existing subscriptions resolve to test rather than erroring against live.

## Data model (`src/lib/db/schema.ts`)

```ts
// plans table — after dodoProductYearly (line ~189)
dodoEnvironment: text("dodo_environment").notNull().default("live"),
// "test" | "live" — which Dodo API + credentials this plan's product IDs use

// subscriptions table — after billingCycle (line ~199)
dodoEnvironment: text("dodo_environment"),
// snapshot of the plan's env at checkout; null for free/stub/legacy → fallback "live"
```

- `npm run db:generate` produces the migration; applied via `db:migrate` / `vercel-build`.
- The free-plan `BEFORE DELETE` trigger (migration `0006`) is untouched — it keys on `OLD.key`.
- No backfill required: existing prod subscriptions are all live, and the `?? "live"` fallback
  covers null rows. (Local dev plan can be flipped to Test via the new toggle.)

## Environment variables

Per-environment credentials, present in **both** deployments:

```
DODO_PAYMENTS_API_KEY_TEST        DODO_PAYMENTS_API_KEY_LIVE
DODO_PAYMENTS_WEBHOOK_SECRET_TEST DODO_PAYMENTS_WEBHOOK_SECRET_LIVE
```

**Backward compatible:** if a `_TEST`/`_LIVE` var is absent, the client falls back to the legacy
single `DODO_PAYMENTS_API_KEY` / `DODO_PAYMENTS_WEBHOOK_SECRET` **only for the env named by
`DODO_PAYMENTS_ENVIRONMENT`**. So nothing breaks today.

**Ops prerequisite to use test products on prod:** add `DODO_PAYMENTS_API_KEY_TEST` (the `OcaV4…`
key) and `DODO_PAYMENTS_WEBHOOK_SECRET_TEST` to the Production environment, then redeploy.

## Dodo client (`api/_lib/dodo.ts`)

```ts
export type DodoEnv = "test" | "live"

// Which env the legacy single-key vars belong to.
const LEGACY_ENV: DodoEnv =
  (process.env.DODO_PAYMENTS_ENVIRONMENT || "test_mode").toLowerCase() === "live_mode" ? "live" : "test"

function baseFor(env: DodoEnv): string {
  return env === "live" ? "https://live.dodopayments.com" : "https://test.dodopayments.com"
}
function keyFor(env: DodoEnv): string | undefined {
  const explicit = env === "live" ? process.env.DODO_PAYMENTS_API_KEY_LIVE : process.env.DODO_PAYMENTS_API_KEY_TEST
  if (explicit) return explicit
  if (env === LEGACY_ENV) return process.env.DODO_PAYMENTS_API_KEY  // backward compat
  return undefined
}
function webhookSecretFor(env: DodoEnv): string | undefined {
  const explicit = env === "live" ? process.env.DODO_PAYMENTS_WEBHOOK_SECRET_LIVE : process.env.DODO_PAYMENTS_WEBHOOK_SECRET_TEST
  if (explicit) return explicit
  if (env === LEGACY_ENV) return process.env.DODO_PAYMENTS_WEBHOOK_SECRET
  return undefined
}
```

Signature changes (env threaded through `call`):

| Function | New signature |
|---|---|
| `authHeader` | `authHeader(env: DodoEnv)` → uses `keyFor(env)` |
| `call<T>` | `call<T>(path, env: DodoEnv, init?)` → `fetch(baseFor(env)+path, …)` |
| `isDodoConfigured` | `isDodoConfigured(env: DodoEnv): boolean` → `!!keyFor(env)` |
| `getProduct` | `getProduct(id, env: DodoEnv)` |
| `createSubscription` | input gains `env: DodoEnv` |
| `getSubscription` | `getSubscription(id, env: DodoEnv)` |
| `cancelSubscription` | `cancelSubscription(id, env: DodoEnv, immediate?)` |
| `fetchInvoicePdf` | `fetchInvoicePdf(paymentId, env: DodoEnv)` |
| `verifyWebhookSignature` | returns `{ valid: boolean; env?: DodoEnv }`; tries `webhookSecretFor("test")` then `…("live")`, skipping unset secrets, returning the matched env |

The unused `DODO_BASE_URL` / `DODO_ENVIRONMENT` exports (line 291) are removed — grep confirms no
importers.

## Server route changes

| File | Change |
|---|---|
| `api/_routes/admin/plans.ts` | `PlanBody.dodo_environment?: DodoEnv`; `previewFromDodo(m, y, env)` → `getProduct(id, env)`; pass `body.dodo_environment ?? "live"` in preview/derive (POST+PATCH); persist `dodoEnvironment` on insert and conditionally on update. 404 warning gains a hint: "…this product may belong to the other Dodo environment (you selected `{env}`)." |
| `api/_routes/billing/create-subscription.ts` | `const dodoEnv = (plan.dodoEnvironment ?? "live") as DodoEnv`; stub branch keyed on `!isDodoConfigured(dodoEnv)`; `createSubscription({…, env: dodoEnv})`; snapshot `dodoEnvironment: dodoEnv` on the pending sub. |
| `api/_routes/billing/cancel.ts` | `const env = (sub.dodoEnvironment ?? defaultDodoEnv()) as DodoEnv`; `cancelSubscription(id, env, false)`. |
| `api/_routes/billing/sync.ts` | `const env = (sub.dodoEnvironment ?? defaultDodoEnv()) as DodoEnv`; gate on `isDodoConfigured(env)`; `getSubscription(id, env)`. |
| `api/_routes/billing/invoice-pdf.ts` | Load the subscription for `invoice.subscriptionId`; `const env = (sub?.dodoEnvironment ?? defaultDodoEnv()) as DodoEnv`; gate on `isDodoConfigured(env)`; `fetchInvoicePdf(id, env)`. |
| `api/billing/webhook.ts` | `const { valid, env } = verifyWebhookSignature(raw, headers); if (!valid) return 400`. New checkouts already snapshot the env; for a matched subscription whose `dodo_environment` is null (legacy), backfill it with the webhook's `env`. |
| `api/_routes/billing/pricing.ts` | **No change** (no Dodo calls). |

## Frontend (`src/pages/admin/AdminPlansPage.tsx`) — raw English, matches existing style

- Local `Plan` type: add `dodo_environment: "test" | "live"`.
- Wizard state: `const [dodoEnvironment, setDodoEnvironment] = useState<"test"|"live">("live")`; reset
  to `"live"` on close.
- **Step 1** (Account type, ~line 350): below the personal/business grid, render a 2-button
  segmented Test/Live toggle (default Live). Label e.g. "Dodo environment".
- `handleSync` (~line 243): add `dodo_environment: dodoEnvironment` to the preview body.
- Wizard `handleSave` (~line 272): add `dodo_environment: dodoEnvironment` to the payload.
- **Inline Integration tab** (~line 831): Test/Live toggle bound to `draft.dodo_environment` via
  `updateDraft`; include `dodo_environment` in the inline PATCH payload (~line 527).
- **Plan card** (~line 648): small "Test" badge when `dodo_environment === "test"`.

`SubscriptionPage.tsx` and the i18n locales are unchanged.

## Error handling / edge cases

- **Unconfigured env on prod:** a test plan with no `DODO_PAYMENTS_API_KEY_TEST` →
  `isDodoConfigured("test")` is false → checkout takes the existing stub branch; preview shows the
  existing "not configured" warning. No crash.
- **Wrong env for a product ID:** preview returns the (now clearer) 404 hint; admin flips the toggle.
- **Legacy/null subscription env:** all read paths use `?? defaultDodoEnv()`; webhooks self-heal null
  rows by writing the env that signed them. (No code deletes subscriptions independently, so this only
  affects rows that predate the feature.)
- **Invoice with null `subscriptionId`** (`ON DELETE SET NULL`): falls back to `defaultDodoEnv()`. The
  env is not denormalized onto invoices because no code path orphans an invoice from its subscription.
- **Webhook with only legacy secret configured:** `webhookSecretFor(LEGACY_ENV)` returns it; the
  other returns undefined and is skipped — legacy single-secret deployments still verify.

## Testing

- **Unit (Vitest):** `keyFor`/`baseFor`/`webhookSecretFor` resolution including legacy fallback;
  `verifyWebhookSignature` dual-secret (valid via test secret, valid via live secret, neither
  matches, missing headers). Add `api/_lib/dodo.test.ts` (confirm vitest include globs cover `api/`;
  otherwise colocate the pure helpers' test under `src/lib`).
- **Manual (local, `test_mode`):** create a plan via the wizard with the toggle on **Test** and the
  two test product IDs → Sync must now return product details (previously 404). Flip an existing
  plan's toggle inline and re-save.
- **Static gates:** `npm run typecheck`, `npm run lint`, `npm run build` all clean.

## Out of scope (YAGNI)

- Per-cycle environment (monthly vs yearly in different envs).
- Multiple coexisting plan rows per tier with distinct keys (rejected — Model A chosen).
- Denormalizing `dodo_environment` onto the invoices table (no code orphans invoices).
- Shared `Plan`/`Subscription` types in `src/lib/types.ts` (pages keep their local types).
