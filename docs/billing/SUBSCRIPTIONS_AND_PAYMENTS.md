# ProfitSync — Subscriptions & Payments, explained

A complete, plain-English guide to how billing works in ProfitSync: who charges the
money, what our database stores, what every status means, how each flow works, and
exactly what the admin panel buttons do. If you read only one document about billing,
read this one.

> **TL;DR**
> - **Dodo Payments** is the real payment system (a "Merchant of Record"). It owns the
>   money, the card, the renewals, the taxes, and the invoices.
> - Our database keeps a **mirror** of each subscription (the `subscriptions` table)
>   and each charge (the `invoices` table). The mirror is kept in sync by **webhooks**
>   and by **explicit reconcile/sync** calls.
> - **A real paid subscription is only ever created when a user completes Dodo's
>   hosted checkout.** Admins can't enter a customer's card, so an admin "upgrade" is a
>   **complimentary grant** (features unlocked locally, no money), and an admin
>   "downgrade/cancel" now **cancels on Dodo** and clears our mirror.

---

## 1. The big picture

```
                 ┌─────────────────────────────────────────────┐
   User pays  →  │  Dodo Payments  (Merchant of Record)        │   ← system of record
                 │  • the subscription + card + renewals       │     for MONEY
                 │  • computes tax, issues invoices            │
                 └───────────────┬──────────────┬──────────────┘
                                 │ webhooks      │ REST API (we call it)
                                 ▼               ▼
                 ┌─────────────────────────────────────────────┐
                 │  ProfitSync DB  (the MIRROR)                 │   ← what our app reads
                 │  • subscriptions (plan, status, period)     │
                 │  • invoices (one row per Dodo payment)      │
                 └─────────────────────────────────────────────┘
```

**Why a mirror?** Our app needs to know "is this org on a paid plan, and is it
current?" on every request, without calling Dodo each time. So we store a local copy
and keep it fresh. The copy is *authoritative for feature-gating*; Dodo is
*authoritative for money*. When they disagree, **Dodo wins** — that's what "Sync from
Dodo" does.

Key files:

| Concern | File |
|---|---|
| Dodo REST client (create/cancel/change/get/list, webhook verify) | `api/_lib/dodo.ts` |
| Pull authoritative state from Dodo → DB (status, dates, invoices) | `api/_lib/billing-sync.ts` |
| Dodo payment → invoice row mapping (pure) | `api/_lib/invoice-map.ts` |
| Admin Dodo-aware helpers (cancel + free reset) | `api/_lib/admin-billing.ts` |
| Full org teardown (cancel Dodo + delete + cleanup) | `api/_lib/admin-org-delete.ts` |
| Webhook receiver (Standard Webhooks signature) | `api/billing/webhook.ts` |
| Self-serve billing routes | `api/_routes/billing/*.ts` |
| Admin billing routes | `api/_routes/admin/{organizations,subscriptions,invoices}*.ts` |
| Plans (admin-configured products, limits, geo pricing) | `plans` table + `api/_routes/admin/plans.ts` |

---

## 2. The data model

### `subscriptions` (one row per organization)
The mirror of the org's plan.

| Column | Meaning |
|---|---|
| `organization_id` | The org this belongs to (FK, cascades on org delete). |
| `plan_key` | `free` \| `personal` \| `business` (legacy: `premium`). `free` is implicit (no `plans` row required). |
| `status` | `pending` \| `active` \| `past_due` \| `cancelled` \| `trialing` — see §3. |
| `billing_cycle` | `monthly` \| `yearly` \| `null` (free). |
| `provider` | `dodo` (real) \| `stub` (dev, Dodo not configured) \| `manual`/`null` (admin/free). |
| `provider_subscription_id` | The Dodo `subscription_id` (the link to Dodo). |
| `dodo_environment` | `test` \| `live` \| `null` — snapshot of which Dodo env this sub lives in, so cancel/sync/invoice keep hitting the right env even if the plan is later re-pointed. |
| `current_period_start` / `current_period_end` | Dodo's `previous_billing_date` / `next_billing_date`. `current_period_end` is what the UI shows as **"Renews on …"**. |
| `scheduled_change` | A future plan/cycle change Dodo has scheduled (e.g. monthly→yearly at period end). |
| `cancel_at` | When access ends (set on cancel-at-period-end). |
| `cancelled_at` | When it was actually terminated. |

### `invoices` (one row per Dodo payment)
| Column | Meaning |
|---|---|
| `provider_invoice_id` | The Dodo **payment id**. Unique → enables an idempotent upsert (webhook retry + reconcile can't duplicate). |
| `status` | `paid` \| `uncollectible` (a failed charge) \| `void` (cancelled) \| `open` (in-flight) \| `draft`/`refunded`. |
| `amount` / `currency` | The charge, converted from Dodo minor units (cents) to a decimal string. |
| `issued_at` / `paid_at` | Dodo's payment timestamp; `paid_at` is null unless the charge succeeded. |

### `plans` (global, admin-configured)
Holds the Dodo product IDs per cycle (`dodo_product_monthly`/`yearly`), the
`dodo_environment` those products live in, the real numeric `limits` (jsonb, enforced
by `api/_lib/quota.ts`), and geo pricing. The source of truth for *what a plan costs
and unlocks*. Free is not a row here — it's the implicit baseline.

---

## 3. What each subscription status means

| Status | What it means for the user | When it's set |
|---|---|---|
| **`pending`** | A checkout was created on Dodo but **payment hasn't completed**. No paid access yet. | `POST /api/billing/create-subscription` sets this right before redirecting to Dodo's hosted checkout. It flips to `active` once payment lands (return→sync or webhook). |
| **`active`** | **Paid and current.** Full plan features. This is also the value used for the implicit **free** tier. | `subscription.active` / `subscription.renewed` webhooks, a successful sync, or an admin grant. |
| **`past_due`** | A **renewal payment failed** / Dodo put the subscription `on_hold` (dunning). Access is usually retained while Dodo retries, but it's at risk. | `payment.failed`, `subscription.on_hold`, `subscription.failed` webhooks. |
| **`cancelled`** | **Terminated.** Either it ended at period end, or it was cancelled immediately. The org effectively drops to free. | `subscription.cancelled` / `subscription.expired` webhooks, or an admin immediate cancel. |
| **`trialing`** | Reserved for trials. **Not used today** (no trial products are configured). | — |

**Dodo's own statuses** are `pending / active / on_hold / cancelled / expired / failed`.
We translate them with `mapDodoStatus()`:

| Dodo | → ours |
|---|---|
| `active` | `active` |
| `on_hold`, `failed` | `past_due` |
| `cancelled`, `expired` | `cancelled` |
| `pending` (and anything else) | `pending` |

**Invoice statuses:** `paid` (succeeded), `uncollectible` (failed charge), `void`
(cancelled), `open` (processing / awaiting), `draft`, `refunded`.

---

## 4. The money flows

### 4a. New paid subscription (self-serve — the only way real money starts)
1. User picks a plan/cycle → `POST /api/billing/create-subscription`.
2. We create the subscription on Dodo with `payment_link: true` and get a **hosted
   checkout URL**. We store a local row as `status: pending, provider: dodo`.
3. User completes payment on Dodo's page (Dodo collects card + billing address + tax).
4. Dodo redirects back to `/subscription?dodo=return`; the app calls
   `POST /api/billing/sync`, which **reconciles** the row from Dodo (status→active,
   period dates, and pulls the payment into `invoices`). The webhook does the same
   asynchronously, so activation doesn't depend on webhooks being configured.

> **Dev note:** when Dodo isn't configured for the plan's environment, create-subscription
> uses a **stub** (`provider: stub`) that marks the row active locally so you can test
> quota unlocking without real money.

### 4b. Renewal
Dodo charges the card each period and fires `subscription.renewed` + `payment.succeeded`.
The webhook updates the period dates and records a `paid` invoice. Idempotent.

### 4c. Payment failure  ← (fixed/added)
Dodo fires `payment.failed`. The webhook now:
- records an **`uncollectible`** invoice (idempotently keyed by the Dodo payment id), and
- flips a currently-`active` subscription to **`past_due`**.
Dodo usually also follows with `subscription.on_hold`/`failed` (also → `past_due`).

### 4d. Cancellation
- **Self-serve** (`POST /api/billing/cancel`): cancels **at period end** on Dodo
  (`cancel_at_next_billing_date`). The sub stays `active` until the period ends (the
  user keeps what they paid for), and `cancel_at` records the end date. Reversible via
  `POST /api/billing/resume`.
- **Admin** (downgrade to free / cancel): cancels **immediately** on Dodo
  (`status: cancelled`, `cancel_reason: cancelled_by_merchant`) so billing stops now
  and Dodo no longer reports it active. See §5.

### 4e. Plan / cycle change
`POST /api/billing/change-plan` switches cycle (e.g. monthly→yearly) immediately on
Dodo, charges the new price, waits for the charge, then reconciles.

---

## 5. The admin panel — exactly what each control does

> **Before this work**, the admin buttons wrote plan/status straight to our DB and
> **never called Dodo**. That caused the two bugs the owner reported: after
> "downgrading" an org to free, the page still showed a **"Renews" date** (we never
> cleared `current_period_end`) and **Dodo still showed the sub active** and kept
> charging. Both are now fixed.

### `/admin/organizations`
- **Upgrade** (free → paid): a **complimentary grant**. It sets the org's plan to the
  one matching its account type (`personal`/`business`) with `status: active`. It does
  **NOT** create a Dodo subscription (an admin can't enter the customer's card) — there
  is no charge. The org gets the features for free until changed.
- **Downgrade / "Free"** (paid → free): now **cancels the Dodo subscription
  immediately** (billing stops) **and** resets the row to a clean free state
  (`FREE_RESET_FIELDS`: clears period, cycle, provider, cancel, scheduled-change). No
  more stale "Renews" date; Dodo no longer shows it active.
- **Rename / currency**: unchanged (edits the org row only).
- **Multi-select + Delete** (new): tick rows → "Delete selected". For each org it
  **cancels the Dodo subscription**, deletes the org's **clients + quotations** (these
  have no org foreign key, so deleting the org alone would orphan them and their
  transactions/attachments), reassigns any user whose active org was deleted, then
  deletes the org (cascading subscriptions, members, categories, wealth accounts,
  audit logs, invoices, invitations). The single-row delete does the same now.

### `/admin/subscriptions`
- **Edit (pencil)**: manual override. Setting **plan→free** or **status→cancelled** is
  now Dodo-aware (cancels on Dodo + clears stale fields). Other edits remain a manual
  correction of the mirror.
- **Multi-select + bulk actions** (new):
  - **Downgrade to Free** — cancel on Dodo + reset each row to free.
  - **Cancel on Dodo** — immediate Dodo cancel + mark the row cancelled (plan kept for
    history).
  - **Sync from Dodo** — pull the authoritative state from Dodo into the mirror
    (status, dates, invoices). Use this to reconcile after any out-of-band change.
- **Per-row "Sync from Dodo"** (the ↻ button): reconcile a single subscription.
- The **`pending`** status is now a filter + an editor option.

**Fail-loud guarantee:** if a Dodo cancel fails on a *single* action, the API returns
an error and **leaves the DB unchanged**, so the admin can retry instead of silently
desyncing the mirror. In *bulk*, each row is independent — one Dodo failure is reported
in the summary toast and doesn't abort the batch.

### `/admin/invoices`
Read-only list of all invoices across orgs, with a document viewer that proxies the
Dodo invoice PDF through our API key (the Dodo invoice URL isn't a public link).

---

## 6. Webhooks (`api/billing/webhook.ts`)

- **Signature:** Standard Webhooks spec (HMAC-SHA256 over `id.timestamp.body`, keyed by
  the base64-decoded secret after the `whsec_` prefix). Headers: `webhook-id`,
  `webhook-timestamp`, `webhook-signature`. We try both the **test** and **live**
  signing secrets and remember which env matched (Dodo doesn't tell us the env).
- **It needs the raw body**, so it's the one route that is its **own Vercel function**
  (`bodyParser: false`) instead of going through the consolidated `api/index.ts` router.
- **Events handled:**
  - `subscription.active` / `renewed` / `plan_changed` → `active`
  - `subscription.on_hold` / `failed` → `past_due`
  - `subscription.cancelled` / `expired` → `cancelled`
  - `payment.succeeded` → record a `paid` invoice (+ credit a pending referral)
  - `payment.failed` → record an `uncollectible` invoice + flip an active sub to
    `past_due`
- **Idempotent:** invoices upsert on the Dodo payment id, so retries don't duplicate.
- **Self-healing:** a legacy row missing `dodo_environment` adopts the env that signed
  the webhook.

> Webhooks are **best-effort** — the app never *depends* on them. The return-from-checkout
> `sync` and the admin "Sync from Dodo" both reconcile the same data directly from Dodo's
> REST API, so a missing/failed webhook is always recoverable.

---

## 7. Environments (test vs live)

Test and live Dodo are **fully separate** datastores with separate keys. Which env a
plan's products live in is a **per-plan** property (`plans.dodo_environment`), snapshotted
onto each subscription at checkout (`subscriptions.dodo_environment`) so cancel/sync/invoice
always hit the right env. Keys resolve per env
(`DODO_PAYMENTS_API_KEY_TEST/_LIVE`), falling back to the legacy single
`DODO_PAYMENTS_API_KEY` for the deployment's default env. `isDodoConfigured(env)` tells
you whether a given env has a key.

---

## 8. Foreign keys & the org "teardown"

Deleting an org cascades these (DB-verified): `subscriptions, organization_members,
categories, wealth_accounts` (+ their attachments), `audit_logs, invoices,
organization_invitations`. **`clients` and `quotations` have NO `organization_id`
foreign key** — so deleting the org row alone orphans them (and, via clients,
transactions + attachments). `teardownOrganization()` therefore deletes clients +
quotations explicitly first, then the org. Use it for any org deletion.

---

## 9. FAQ (the questions that started this)

**Q: Do the admin Upgrade/Downgrade buttons talk to Dodo?**
Originally **no** — pure DB writes. **Now**: downgrade-to-free / cancel **do** cancel on
Dodo and clear the mirror. Upgrade stays a comp grant (no Dodo sub, no charge).

**Q: I downgraded an org to free but it still shows a "Renews" date and Dodo still says
active.**
That was the bug. The old code never cleared `current_period_end` and never called
Dodo. Fixed: downgrade-to-free now applies `FREE_RESET_FIELDS` (clears the renew date,
cycle, provider) and cancels the Dodo subscription immediately.

**Q: Why can't an admin just "upgrade" someone to a real paid plan?**
Because real billing needs the customer's payment method, entered on Dodo's hosted
checkout. An admin upgrade is a **free comp grant**. A real paid subscription only ever
comes from the user completing checkout.

**Q: A customer's card failed — where do I see it?**
After the fix, a failed charge appears as an **`uncollectible`** invoice and the
subscription shows **`past_due`**. (Use "Sync from Dodo" if you want to force-refresh
from Dodo.)

**Q: The mirror looks wrong / out of date. How do I fix it?**
Use **Sync from Dodo** (per-row or bulk) — it pulls the authoritative state (status,
dates, invoices) straight from Dodo.

---

## 10. Testing notes (for engineers)

- The **pre-commit gate is DB-free** — never add a test that touches the database to
  the committed suite. Pure logic (`admin-billing.test.ts`, `invoice-map.test.ts`,
  `dodo.test.ts`) is unit-tested.
- To verify DB-touching behaviour, write a **throwaway** `*.test.ts`, run it with
  `node -r dotenv/config node_modules/.bin/vitest run <file> dotenv_config_path=.env.local`,
  then **delete it** (so it never enters the gate). Always seed clearly-marked
  throwaway rows (e.g. slug `zzz-…`) and clean them up.
- Never run a real Dodo cancel against the shared dev/test subscriptions — use a `stub`
  provider row, or mock `fetch`/`cancelSubscription`.

See `.claude/skills/subscription-system/SKILL.md` for the AI-facing operating guide.
