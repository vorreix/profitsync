# Admin Subscriptions + Dodo Payments — Investigation & Fix Plan

> Living tracker for the "make the admin subscription panel actually talk to Dodo"
> work. Branch chain off `dev`. Each branch = one task, created **from the
> previous** (stacked), pushed to GitHub. Update the status table + change log as
> each branch lands. The user is not available mid‑run — decisions are recorded
> here with their reasoning.

**Companion docs (read these too):**
- `docs/billing/SUBSCRIPTIONS_AND_PAYMENTS.md` — the full human explainer (what
  every status means, how money flows, admin vs user paths). _(lands in branch 05)_
- `.claude/skills/subscription-system/SKILL.md` — the AI skill so any future
  Claude session understands this system. _(lands in branch 05)_

---

## 1. The questions the user asked (answered)

### Q1 — "Do the admin Upgrade/Downgrade buttons connect to Dodo? Do they update Dodo?"

**No. They never touch Dodo.** They are pure local‑DB writes.

- `/admin/organizations` → the **Upgrade / Free** button calls
  `togglePlan()` → `PATCH /api/admin/organizations { plan_key, plan_status }`.
  The handler (`api/_routes/admin/organizations.ts`, the `PATCH` branch) only does
  `UPDATE subscriptions SET plan_key=…, status=… WHERE organization_id=…`. There is
  **no import of `api/_lib/dodo.ts` in that file at all.**
- `/admin/subscriptions` → the pencil/edit dialog calls
  `PATCH /api/admin/subscriptions`. Same story: it writes `plan_key / status /
  billing_cycle / current_period_end` to the row and **never calls Dodo.**
- `/admin/organizations/:id` (detail page) → the header **Downgrade to free** button
  and the **Subscription** tab both go through the same two routes above.

So the admin buttons are a **manual override of our local mirror only**. Dodo is the
real system of record for money; nothing we do in the admin panel reaches it today.

### Q2 — "I downgraded every org to free with the buttons, but /admin/subscriptions still shows 'Renews' with a date, and Dodo still says the subscription is active."

**Both are direct consequences of Q1, and both are real bugs:**

1. **Stale "Renews" date.** The org `PATCH` only sets `plan_key='free'` +
   `status='active'`. It leaves `current_period_end`, `billing_cycle`, `provider`,
   `provider_subscription_id`, `cancel_at`, `scheduled_change`, `current_period_start`
   **untouched.** `/admin/subscriptions` renders `current_period_end` in the "Renews"
   column → it keeps showing the old renewal date even though the plan now says free.
   _(Verified by reading the handler + the page; not a hypothesis.)_

2. **Dodo still active / still billing.** Because no Dodo API call is ever made, the
   subscription on Dodo's side keeps its `active` status and **keeps charging the
   customer on the next billing date.** The admin "downgrade" did nothing to the
   actual payment processor.

### Q3 — "What does each status on /admin/subscriptions mean?"

Our internal `subscriptions.status` enum and what each value means — full table is in
`SUBSCRIPTIONS_AND_PAYMENTS.md`; summary:

| status | meaning | set by |
|---|---|---|
| `pending` | Checkout created on Dodo, payment **not yet completed**. No access. | `create-subscription` (before the user pays). _Note: not currently in the admin filter list — fixed in branch 04._ |
| `active` | Paid & current. Full plan features. (Also the value for the implicit **free** tier.) | webhook `subscription.active/renewed`, sync, admin grant |
| `past_due` | A renewal **payment failed** / Dodo put it `on_hold`/`failed`. Access usually retained during dunning, but at risk. | webhook `subscription.on_hold/failed`, `payment.failed` (branch 02) |
| `cancelled` | Terminated. Either ended at period end or cancelled immediately. Drops to free. | webhook `subscription.cancelled/expired`, immediate admin cancel |
| `trialing` | Reserved for trials. **Not used today** (no trial products configured). | — |

Dodo's own statuses (`pending / active / on_hold / cancelled / expired / failed`) are
translated into ours by `mapDodoStatus()` in `api/_lib/dodo.ts`.

---

## 2. Verified ground truth (read from code + the live dev DB)

- **Billing model:** Dodo Payments is the Merchant of Record. Subscriptions use a
  hosted checkout (`payment_link: true`). The real subscription + charges live on
  Dodo; our `subscriptions` / `invoices` tables are a **mirror** kept in sync by
  (a) the webhook (`api/billing/webhook.ts`) and (b) explicit reconcile
  (`api/_lib/billing-sync.ts#reconcileSubscriptionFromDodo`, called from
  `/api/billing/sync` and `change-plan`).
- **The self‑serve "switch to free" path already does it right:**
  `api/_routes/billing/create-subscription.ts` (the `plan_key === "free"` branch)
  clears every Dodo field (`provider=null`, `current_period_end=null`, `cancel_at=null`,
  …). The admin path was simply never given the same treatment. Our fix makes the
  admin path match — **plus** it actually cancels on Dodo (the self‑serve free path
  doesn't call Dodo either, but the self‑serve cancel button at `/api/billing/cancel`
  does; see SUBSCRIPTIONS_AND_PAYMENTS.md for that nuance).
- **`cancelSubscription(id, env, true)`** already does an **immediate** Dodo cancel via
  `PATCH /subscriptions/{id} { status: "cancelled" }` — confirmed against Dodo's API
  docs. Immediate (not end‑of‑period) is the right choice for an admin force‑downgrade,
  because that's the only way Dodo stops showing "active" right away (which was the
  user's exact complaint).
- **Org delete orphans data (DB‑verified).** Foreign keys that cascade from
  `organizations`: `audit_logs, categories, invoices, organization_invitations,
  organization_members, subscriptions, wealth_accounts`. **`clients` and `quotations`
  have NO `organization_id` foreign key** → deleting an org leaves orphaned clients,
  quotations, and (via clients) transactions + attachments. The current single‑org
  delete has this bug too. Our bulk delete (branch 03) explicitly deletes the org's
  clients + quotations first (their own cascades clean up transactions/attachments),
  then deletes the org.
- **Live dev DB snapshot:** 45 free/legacy subs (`provider=null, active`), 4 real Dodo
  test‑mode subs (2 `active`, 2 `past_due`). Dodo is configured locally in
  **`test_mode`**. Invoices: 6 `paid`, 2 `uncollectible` (failed charges already land
  via the reconcile path's `failed → uncollectible` mapping).
- **Admin console is intentionally English‑only (no i18n)** — see the note in
  `src/lib/admin-roles.ts`. New admin UI strings do **not** need locale files, so the
  i18n parity gate is unaffected by these branches.
- **Auth/caps:** admin routes use `requireAdminCap(req,res,cap)`. `read` for GET,
  `write` for mutations. `super_admin` + `editor` have `write`. Bulk delete / bulk
  Dodo actions are `write` (consistent with the existing single‑row mutations).

---

## 3. Design decisions (made without the user, recorded here)

1. **Admin "downgrade to free" = immediate Dodo cancel + full local reset.** This is
   the only behaviour that satisfies "Dodo should not still say active." If the Dodo
   call fails on a single‑org action, we **fail loud** (HTTP 502, DB unchanged) so the
   admin can retry — we never desync the mirror from Dodo silently.
2. **Admin "upgrade to paid" stays a comp grant (no Dodo subscription created).** An
   admin can't enter a customer's card; creating a real Dodo subscription requires the
   hosted checkout. So an admin upgrade is a **complimentary** grant that unlocks
   features locally without billing. Documented clearly so it isn't mistaken for a paid
   conversion. (A real paid sub only ever comes from the user completing checkout.)
3. **Bulk operations are resilient:** each org/subscription is processed
   independently; one Dodo failure doesn't abort the batch. The response reports
   per‑row outcomes and the UI surfaces a summary toast.
4. **Payment failures are recorded** as an `uncollectible` invoice row (reusing the
   existing `failed → uncollectible` mapping) and flip an `active` subscription to
   `past_due`. We do not invent a new status/column — the existing enum already
   models this.
5. **No schema migration is required.** Everything maps onto existing columns/enums.
   We still run `db:migrate` locally to prove the schema is current.

---

## 4. Branch chain (the live tracker)

Created from `dev`, each from the previous. `gh` is not authenticated in this env, so
PRs are opened from the `pull/new/<branch>` URL GitHub prints on push (recorded below).

| # | Branch | Task | Status |
|---|---|---|---|
| 00 | `feat/admin-billing-00-plan` | This plan + findings doc | ✅ committed |
| 01 | `feat/admin-billing-01-dodo-aware-admin` | Make admin plan/status changes Dodo‑aware: cancel on Dodo + clear stale period/cancel/provider fields when downgrading to free / cancelling. Fixes Q2. `api/_lib/admin-billing.ts` + unit tests. | ✅ committed |
| 02 | `feat/admin-billing-02-payment-failed` | Record payment failures in the DB: webhook `payment.failed` → `uncollectible` invoice + `past_due` sub. Unit test the mapping. | ✅ committed |
| 03 | `feat/admin-billing-03-bulk-delete-orgs` | Multi‑select + bulk delete on `/admin/organizations`. Delete cancels each org's Dodo sub + cleans orphaned clients/quotations + cascades the rest. | ✅ committed |
| 04 | `feat/admin-billing-04-bulk-subscriptions` | Multi‑select + bulk actions on `/admin/subscriptions` (Downgrade→Free w/ Dodo, Cancel on Dodo, Sync from Dodo) + per‑row Sync + add `pending` to filters. | ⏳ pending |
| 05 | `feat/admin-billing-05-docs-skill` | The detailed explainer doc + the `subscription-system` AI skill. Final tracker + memory update. | ⏳ pending |

---

## 5. Per‑task detail

### 01 — Dodo‑aware admin plan changes (the core fix)
- **Problem:** admin downgrade leaves stale renew date + never cancels Dodo (Q1/Q2).
- **Approach:** new `api/_lib/admin-billing.ts` exporting `FREE_RESET_FIELDS`
  (the clean free‑tier column set), `isDodoSubscription`, `dodoEnvForSub`,
  `isAlreadyGoneCancelError`, and `stopDodoBilling(sub)` (immediate cancel, no‑op for
  stub/manual, 404=success, never throws). Wire into `PATCH /api/admin/organizations`
  and `PATCH /api/admin/subscriptions`: downgrade→free ⇒ stop Dodo + apply
  `FREE_RESET_FIELDS`; status→cancelled ⇒ stop Dodo + set cancelled/cancelAt.
- **Files:** `api/_lib/admin-billing.ts` (new), `api/_lib/admin-billing.test.ts` (new),
  `api/_routes/admin/organizations.ts`, `api/_routes/admin/subscriptions.ts`,
  `api/_lib/dodo.ts` (add `cancel_reason: cancelled_by_merchant` to immediate cancel).
- **Risk:** money path → verify the pure logic with unit tests + a throwaway stub‑sub
  integration check; never call real Dodo against the user's 4 live test subs.
- **Verify:** unit tests; throwaway org+stub‑sub reset asserted against the dev DB then
  cleaned up; typecheck + full gate.
- **Status:** ⏳

### 02 — Record payment failures
- **Problem:** a failed charge isn't recorded in real time; sub isn't flipped past_due.
- **Approach:** in `api/billing/webhook.ts` add a `payment.failed` (payload_type
  `Payment`) branch: upsert an `uncollectible` invoice keyed by `payment_id`, and set
  the sub `past_due` when it's currently `active`. Reuse `invoiceStatusForPayment`.
- **Files:** `api/billing/webhook.ts`, test in `api/_lib/invoice-map.test.ts` (assert
  `failed → uncollectible`).
- **Status:** ⏳

### 03 — Bulk delete organizations
- **Approach:** `api/_routes/admin/organizations/bulk-delete.ts` (POST `{ organization_ids }`)
  — per org: `stopDodoBilling`, delete clients + quotations (cascades transactions/
  attachments), reassign affected `current_organization_id`, delete org. Register route.
  UI: checkbox column + select‑all + bulk bar + confirm dialog on `AdminOrgsPage`,
  optimistic row removal + summary toast.
- **Files:** new route, `api/index.ts`, `src/pages/admin/AdminOrgsPage.tsx`.
- **Status:** ⏳

### 04 — Bulk subscription actions + sync
- **Approach:** `api/_routes/admin/subscriptions/actions.ts`
  (POST `{ subscription_ids, action: downgrade_free | cancel_dodo | sync }`) reusing the
  branch‑01 helper + `reconcileSubscriptionFromDodo`. UI: checkbox column + bulk bar +
  per‑row "Sync from Dodo"; add `pending` to the status filter + editor.
- **Files:** new route, `api/index.ts`, `src/pages/admin/AdminSubscriptionsPage.tsx`.
- **Status:** ⏳

### 05 — Docs + skill
- `docs/billing/SUBSCRIPTIONS_AND_PAYMENTS.md` (the human explainer) and
  `.claude/skills/subscription-system/SKILL.md` (the AI skill). Final tracker + memory.
- **Status:** ⏳

---

## 6. Change log

- **00** — Investigation complete; root cause verified by hand + against the live dev
  DB (FK cascade audit, sub/invoice snapshot). Plan + branch chain authored.
- **01** — `api/_lib/admin-billing.ts` (+13 unit tests). Admin org + subscription PATCH
  now: downgrade→free ⇒ `stopDodoBilling` (immediate Dodo cancel, no‑op for stub/free,
  404=success) + `FREE_RESET_FIELDS`; status→cancelled ⇒ stop Dodo + `cancelledNowFields`.
  Dodo error ⇒ HTTP 502, DB untouched (no silent desync). `pending` added to the
  subscriptions status set. `cancel_reason: cancelled_by_merchant` added to immediate
  Dodo cancels. Verified: unit tests + typecheck + a throwaway‑org DB proof that the
  free‑reset clears the stale renew date (then self‑cleaned).
- **02** — `payment.failed` webhook branch: idempotent `uncollectible` invoice (keyed
  by Dodo payment id) + flips an `active` sub to `past_due`. Verified end‑to‑end with a
  **signed** webhook against the live dev DB on a throwaway org (invoice `19.99`,
  unpaid; sub `past_due`), then self‑cleaned. `failed → uncollectible` mapping already
  unit‑tested.
- **03** — Shared `api/_lib/admin-org-delete.ts#teardownOrganization` (cancel Dodo →
  delete clients+quotations → reassign profiles → delete org). New
  `admin/organizations/bulk-delete.ts` route (registered). Single DELETE refactored to
  reuse it (so it now also cancels Dodo + cleans orphans — previously it left orphaned
  clients/quotations). `AdminOrgsPage`: checkbox column + select‑all + bulk bar +
  confirm dialog + optimistic row removal + Dodo‑cancel summary toast. Verified:
  teardown integration test on the live dev DB (client/tx/quotation/wealth/member/sub
  all removed, stub→no Dodo call), then self‑cleaned. Admin UI is typecheck‑ +
  pattern‑verified (mirrors the TransactionsPage selection pattern); live admin‑login
  browser check deferred (needs an app‑admin Clerk session).
