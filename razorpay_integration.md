# Razorpay Integration

This document describes how ProfitSync integrates with [Razorpay Subscriptions](https://razorpay.com/docs/payments/subscriptions/) for recurring billing.

## Overview

- Each **organization** owns one **subscription** row.
- Free plan: no Razorpay involvement. Plan key `free`, status `active`, no provider fields.
- Premium plan: Razorpay manages the recurring charge. We mirror state in our `subscriptions` and `invoices` tables.
- Pricing is geo-aware: the `plans.geo_pricing` JSON maps ISO country codes to localized amount + currency + discounts. Detection uses the `x-vercel-ip-country` header in production; falls back to `US`.

## Setup

### 1. Razorpay dashboard
1. Create a Razorpay account at <https://dashboard.razorpay.com/>.
2. In **Settings → API Keys**, generate a Key ID + Secret. Use **Test Mode** while developing.
3. In **Settings → Webhooks**, add a webhook:
   - URL: `https://<your-deployment>/api/billing/webhook`
   - Active events: `subscription.activated`, `subscription.charged`, `subscription.cancelled`, `subscription.completed`, `subscription.halted`, `subscription.paused`, `invoice.paid`, `payment.failed`
   - Set a strong secret (used to verify signatures).

### 2. Environment variables

Add these to `.env.local` for local dev and to Vercel Project Settings → Environment Variables:

```
RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXX
RAZORPAY_KEY_SECRET=••••••••••••
RAZORPAY_WEBHOOK_SECRET=••••••••••••
```

When the key id/secret are **absent**, `/api/billing/create-subscription` falls into stub mode and flips the subscription to `active` locally without calling Razorpay. This keeps local QA + quota testing unblocked.

### 3. Plans

Plans live in the `plans` table and are administrable from `/admin/plans`. The seed script creates `free` and `premium`. Geo pricing lets you charge:

- US/default: USD (uses `monthlyPriceUsd` / `yearlyPriceUsd`).
- IN: INR (uses `geo_pricing.IN.monthly` / `.yearly` in **minor units** = paise).

Discount percentages live alongside the prices. The frontend shows the discounted amount and the original struck-through price.

## End-to-end flow

```
User clicks "Subscribe to Premium" on /subscription
        │
        ▼
POST /api/billing/create-subscription { plan_key, cycle }
        │  · resolves local plan + geo amount
        │  · calls Razorpay POST /plans (idempotently) → planId
        │  · calls Razorpay POST /subscriptions { plan_id, notes }
        │  · upserts subscriptions row with status="pending", provider="razorpay"
        ▼
{ checkout_url: rzpSub.short_url }   ← frontend opens this in a new tab

User completes payment on Razorpay hosted checkout
        │
        ▼
Razorpay → POST /api/billing/webhook
        │  · verifyWebhookSignature(rawBody, x-razorpay-signature)
        │  · event=subscription.activated → subscriptions.status = "active"
        │  · event=invoice.paid → insert/update invoices row with paidAt
        ▼
Frontend's pricing endpoint re-fetched → UI shows "Current plan: Premium · active"
        │
        ▼
Quotas unlock immediately (getOrgPlan reads subscription.plan_key)
```

### Cancellation flow

```
User clicks "Cancel subscription"
        │
        ▼
POST /api/billing/cancel
        │  · calls Razorpay POST /subscriptions/{id}/cancel { cancel_at_cycle_end: 1 }
        │  · subscriptions.status = "cancelled"
        │  · subscriptions.cancelAt  = currentPeriodEnd
        ▼
Webhook later: subscription.cancelled → confirms state, sets cancelledAt
```

Premium features remain available until `current_period_end`.

## Webhook signature verification

`api/_lib/razorpay.ts` exports `verifyWebhookSignature(rawBody, sigHeader)`:

- `bodyParser: false` is set on `/api/billing/webhook` so we can hash the raw body.
- Uses `crypto.createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)` + `timingSafeEqual` to avoid timing attacks.
- Rejected requests get 400; verified requests proceed.

## Testing locally

1. Without keys: stub mode (the create-subscription endpoint upserts an active premium row without ever calling Razorpay). Verify quotas unlock.
2. With test keys: use Razorpay's **test cards** (e.g. 4111 1111 1111 1111, any future expiry). Trigger sandbox webhooks via the Razorpay dashboard "Test webhook" button to confirm the local handler updates `subscriptions` and `invoices`.
3. End-to-end on a deployed preview: connect your test webhook endpoint to the preview URL.

## What's intentionally minimal

- Email notifications are not yet wired in; webhook handlers leave room (e.g. `payment.failed`) for a future `sendEmail()` call.
- Proration on plan switches relies on Razorpay's default behavior (cancel + new subscription).
- Multi-currency invoicing reuses the currency captured at webhook time — no FX conversion.

When you add Razorpay credentials and trigger your first real subscription, the flow above is the contract to validate against.
