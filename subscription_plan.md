# ProfitSync Subscriptions — Dodo Payments Integration

> Status: **Implemented & tested against the Dodo test API.** Razorpay has been fully removed.
> Last updated: 2026-05-29.

## 1. Why Dodo Payments

Razorpay was removed because:
- Razorpay **Subscriptions** require account-level product activation that was blocked behind an
  onboarding checklist (a completed test transaction), and recurring payments kept failing
  ("seller does not support recurring payments").
- Razorpay only settles in **INR** and is India-centric, which conflicts with ProfitSync's goal of
  selling globally (India, EU, Middle East, Africa, Asia, Americas).

**Dodo Payments** is a **Merchant of Record (MoR)**:
- Sells globally and presents **localized currency + tax** automatically at checkout.
- Handles VAT/GST/sales-tax compliance on our behalf (we are not the merchant of record).
- First-class **subscriptions** with no onboarding blockers.
- Works for an **India-registered company** selling worldwide.

## 2. Architecture

```
SubscriptionPage (React)
      │  POST /api/billing/create-subscription { plan_key, cycle }
      ▼
create-subscription.ts ──► Dodo POST /subscriptions (payment_link:true)
      │                         └─► returns { subscription_id, payment_link }
      │  store row: status="pending", provider="dodo", providerSubscriptionId
      ▼
  returns { checkout_url }
      │
      ▼  window.location = checkout_url
Dodo hosted checkout  ──(buyer pays; Dodo collects full billing + tax)──►
      │
      ├─► redirect to return_url:  /subscription?dodo=return
      │        └─► POST /api/billing/sync  ──► Dodo GET /subscriptions/{id}
      │                 └─► maps status, sets status="active", currentPeriodEnd
      │
      └─► webhook POST /api/billing/webhook  (Standard Webhooks signed)
               └─► subscription.active / renewed / cancelled / on_hold / expired
                        └─► updates the subscription row by providerSubscriptionId
```

Two independent activation paths (return-URL **sync** + **webhook**) make activation robust:
the plan unlocks immediately on return even before webhooks are configured, and the webhook keeps
state correct for renewals/cancellations/dunning thereafter. Both are idempotent.

### Files

| File | Role |
|---|---|
| `api/_lib/dodo.ts` | Dodo client: `createSubscription`, `getSubscription`, `cancelSubscription`, `productIdForPlan`, `mapDodoStatus`, `verifyWebhookSignature` (Standard Webhooks). |
| `api/billing/create-subscription.ts` | Free upsert · stub mode · Dodo subscription + hosted checkout link. |
| `api/billing/sync.ts` | **New.** Reconciles the org's latest subscription from Dodo on checkout return. |
| `api/billing/webhook.ts` | Verifies Standard Webhooks signature; drives subscription lifecycle + records invoices on `payment.succeeded`. |
| `api/billing/cancel.ts` | Cancels at end of current period via `PATCH {cancel_at_next_billing_date:true}`. |
| `api/billing/pricing.ts` | Plan + pricing list (USD base; Dodo localizes at checkout). |
| `src/pages/SubscriptionPage.tsx` | Redirects to Dodo hosted checkout; reconciles on `?dodo=return`. |
| `src/lib/db/schema.ts` | `subscriptions.provider` now `dodo | stub | manual | null`. |

**Removed:** `api/_lib/razorpay.ts`, `api/billing/create-order.ts`, `api/billing/verify-payment.ts`.

## 3. Environment variables (`.env.local`)

```
DODO_PAYMENTS_API_KEY=...                 # Dashboard → Developer → API Keys (test or live)
DODO_PAYMENTS_ENVIRONMENT=test_mode       # test_mode | live_mode
DODO_PAYMENTS_WEBHOOK_SECRET=             # Dashboard → Developer → Webhooks (whsec_...)  ← STILL NEEDED
DODO_PRODUCT_PREMIUM_MONTHLY=pdt_0Nfqcsl4LbYBX5BDnqjaU   # $5/mo recurring (dashboard)
DODO_PRODUCT_PREMIUM_YEARLY=pdt_0NfqlOEhA0RFDof1pC0ht    # $50/yr recurring (created via API)
```

- If `DODO_PAYMENTS_API_KEY` is blank, `create-subscription` falls into **stub mode**
  (marks the org premium locally) so QA can proceed without keys.
- Base URL is derived from `DODO_PAYMENTS_ENVIRONMENT`:
  `test_mode → https://test.dodopayments.com`, `live_mode → https://live.dodopayments.com`.

## 4. Verified Dodo API contract (probed live against the test API)

**Auth:** `Authorization: Bearer <DODO_PAYMENTS_API_KEY>`

**Create subscription** — `POST /subscriptions`
```json
{ "product_id": "pdt_...", "quantity": 1, "payment_link": true,
  "return_url": "https://app/subscription?dodo=return",
  "customer": { "email": "...", "name": "..." },
  "billing":  { "country": "US", "state": "", "city": "", "street": "", "zipcode": "" },
  "metadata": { "organization_id": "...", "plan_key": "premium", "billing_cycle": "monthly" } }
```
→ `{ subscription_id, payment_link, client_secret, payment_id, customer:{customer_id,...}, expires_on }`
- `customer` **and** `billing` are **required**; only `billing.country` needs a value — the hosted
  checkout collects/confirms the full address.

**Get subscription** — `GET /subscriptions/{id}` → `{ status, next_billing_date, cancel_at_next_billing_date, cancelled_at, customer, ... }`
- status flow: `pending → active`, plus `on_hold | cancelled | expired | failed`.

**Cancel** — `PATCH /subscriptions/{id}` `{ "cancel_at_next_billing_date": true }` (end of period) or `{ "status": "cancelled" }` (immediate).

**Webhooks** — Standard Webhooks. Headers `webhook-id`, `webhook-timestamp`, `webhook-signature`.
Verify: `base64( HMAC_SHA256( base64decode(secret without "whsec_"), "{id}.{timestamp}.{rawBody}" ) )`
compared against each space-separated `v1,<sig>` token. Body: `{ business_id, type, timestamp, data:{ payload_type, ... } }`.
Subscription events: `subscription.active | renewed | on_hold | cancelled | failed | expired | plan_changed`.

> Note: `POST /checkout-sessions` is **RBAC-denied** for the current test key, so we use
> `POST /subscriptions` with `payment_link:true` (also hosted, also collects billing).

## 5. Products & pricing

| Plan | Cadence | Dodo product | Price |
|---|---|---|---|
| Premium | Monthly | `pdt_0Nfqcsl4LbYBX5BDnqjaU` | $5.00 / mo USD |
| Premium | Yearly  | `pdt_0NfqlOEhA0RFDof1pC0ht` | $50.00 / yr USD |

The `plans` table was aligned to **$5/mo, $50/yr USD** and the old INR-only `geo_pricing` was cleared,
because Dodo (MoR) presents the correct local currency + tax at checkout. The pricing page shows the
USD base; the buyer sees their localized amount on Dodo's page.

## 6. Remaining setup to go fully live

1. **Webhook secret (test):** Dodo Dashboard → Developer → Webhooks → add endpoint
   `https://<deployment>/api/billing/webhook`, copy the signing secret into
   `DODO_PAYMENTS_WEBHOOK_SECRET`. (Until then, activation still works via the return-URL sync path;
   only renewals/cancellations-from-Dodo rely on the webhook.)
2. **Go-live:** set `DODO_PAYMENTS_ENVIRONMENT=live_mode`, swap in the live API key
   (kept commented in `.env.local`), recreate the two products in live mode and update the
   `DODO_PRODUCT_*` ids, and add a live webhook endpoint + secret.

## 7. Testing

- Verified against the live **test** API: product fetch, `POST /subscriptions` (returns a real
  `https://test.checkout.dodopayments.com/...` link), `GET /subscriptions/{id}`, `PATCH` cancel,
  and yearly product creation — all HTTP 200.
- `npm run typecheck` passes.
- End-to-end UI test: Subscription page → Subscribe → Dodo hosted checkout → complete test payment →
  return to app → plan shows **active** (via `/api/billing/sync`).
