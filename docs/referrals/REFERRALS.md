# ProfitSync — Referrals ("Refer & Earn"), explained

A complete, plain-English guide to how the referral program works: who earns what, how a
referral travels from a shared link to real money, every status it passes through, how a
user redeems, and exactly what the admin controls do. If you read one document about
referrals, read this one.

> **TL;DR**
> - Every user has a **shareable referral code/link**. When a new person signs up through
>   it and **their organization makes its first paid upgrade**, the referrer earns a
>   reward.
> - The reward is **snapshotted** the moment the referral becomes *paid* (so later changes
>   to the program never alter money already owed).
> - Earnings become **redeemable after a holding period** (anti-refund-fraud window).
>   The user requests a payout; an admin pays it out manually and marks it done.
> - **The fix in this wave:** a paid upgrade now credits the referrer on the
>   return-from-checkout reconcile path, not only via the webhook — so paid status is
>   recorded even when webhooks aren't configured (the common dev/test setup).

---

## 1. The big picture

```
   Referrer shares link  (profitsync.net/?r=CODE)
            │
            ▼
   New user signs up  ──► referral row: status = signed_up        (attribution)
            │
            ▼
   That user's org pays (personal $2.49/mo·$24.99/yr OR business $4.99/mo·$49.99/yr)
            │
            ▼
   referral row: status = paid   (reward snapshotted, holding clock starts)
            │   …holding period (default 14 days)…
            ▼
   reward becomes "available"  ──► user requests a payout
            │
            ▼
   admin approves → marks paid  ──► referral row: status = paid_out   (done)
```

Money is **always computed server-side** from the `referrals` + `payout_requests` tables;
the client value is never trusted.

---

## 2. Who earns what

- **Reward type** (admin-configurable, one global setting):
  - **percent** — a percentage of the referred org's first payment (default **25%**).
  - **fixed** — a flat amount per successful referral.
- **Reward currency** — the program currency (default USD); the reward amount is stored in
  it, snapshotted at the moment of `paid`.
- **Both kinds of upgrade count.** Whether the referred user upgrades their **personal**
  account or creates and upgrades an **organization**, the paying org's owner is the
  referred user, so the referrer is credited. (A referral is recorded once per referred
  user — the **first** qualifying paid charge credits it.)
- **No self-referral**, and a user can be referred **once** (unique `referred_user_id`).

---

## 3. The lifecycle & statuses

`referrals.status`:

| Status | Meaning | Set by |
|---|---|---|
| **`signed_up`** | The referred user created an account through the link, but no paid upgrade yet. Counts as a *signup*, earns nothing yet. | `attributeReferral()` on the referred user's first `GET /api/profile` (`api/_routes/profile.ts`). |
| **`paid`** | The referred org made its first paid charge. The reward is snapshotted; the holding clock starts (`qualifying_at = now + holding_days`). | `creditReferralOnPaid()` (`api/_lib/referral.ts`) from the webhook **and** the reconcile path. |
| **`paid_out`** | The referrer has been paid for this referral (a payout request was marked *paid*). | `PATCH /api/admin/payouts/:id` when status → `paid`. |

`payout_requests.status`: `requested` → `approved` → `paid` (or `rejected`).

### How attribution works (signup)
1. The landing/signup link carries `?r=CODE`. `SignupPage` persists it (`localStorage` +
   Clerk `unsafeMetadata.referralCode`) so it survives the landing → signup hop.
2. On the new user's first `GET /api/profile`, the code is read from Clerk metadata and
   `attributeReferral(userId, code)` inserts a `signed_up` referral (no-ops on empty/
   unknown code, self-referral, or an already-referred user).

### How crediting works (first payment)
`creditReferralOnPaid(orgId, paymentAmount, currency)`:
- Finds the paying org's owner, then a **`signed_up`** referral for that owner.
- Snapshots the reward (fixed amount, or `percent% × paymentAmount`), the currency, the
  type, and `qualifying_at = now + holding_days`.
- Transitions `signed_up → paid` **guarded by a WHERE on status**, so it is **idempotent**:
  concurrent/replayed webhooks, renewals, and double reconciles can never double-credit.

It is called from **two** places (both safe because of the status guard):
- The **`payment.succeeded` webhook** (`api/billing/webhook.ts`).
- The **reconcile path** `reconcileInvoices()` (`api/_lib/billing-sync.ts`) whenever a
  paid invoice is recorded — i.e. on return-from-checkout `POST /api/billing/sync`, the
  admin "Sync from Dodo", and the billing invoices GET.

> **Why both?** The app deliberately **never depends on webhooks** for activation — the
> return-from-checkout `sync` reconciles directly from Dodo's REST API. Crediting used to
> live *only* in the webhook, so when webhooks weren't configured for the plan's Dodo
> environment (the typical dev/test setup), a real paid upgrade activated the subscription
> and wrote the invoice but **never flipped the referral to paid**. That was the reported
> bug. Crediting on the reconcile path closes the gap; the idempotency guard makes running
> it from both places harmless.

---

## 4. The holding period (why earnings aren't instantly redeemable)

When a referral becomes `paid`, its reward is **not** immediately redeemable. It becomes
**available** only after `qualifying_at` (= the `paid` moment + `holding_days`, default
**14**). This protects against paying out on a charge that is later refunded/charged back.

`computeStats(userId)` returns:
- `signups` — count of all referrals.
- `paid` — count of `paid` + `paid_out`.
- `lifetimeEarned` — sum of rewards on `paid` + `paid_out` (shows immediately).
- `eligibleEarned` — sum of rewards on `paid` whose `qualifying_at <= now`.
- `outstanding` — sum of the user's `requested`/`approved`/`paid` payout requests.
- **`available` = max(0, eligibleEarned − outstanding)** — what the user can withdraw now.

So right after an upgrade the user sees the **paid count and lifetime earnings go up**
immediately, but `available` stays 0 until the holding period elapses.

> **Testing tip:** to make earnings redeemable immediately in a test, an admin can set
> **`holding_days = 0`** in the admin referral settings (and `min_payout` to a low value).
> This is the lever — there is no code change needed.

---

## 5. Redemption (the user side)

On **`/referrals`** the user sees their code, a copy/share button, their stats, their
referral list, and a **Request payout** form.

- `POST /api/referrals/payouts` validates the requested amount server-side against
  `available` and the configured `min_payout`, and accepts a payout **method**
  (`upi` | `paypal` | `bank`) with sanitized detail fields.
- A **partial unique index** allows only **one pending request per user**, atomically
  preventing concurrent double-spend.
- The request appears with status `requested` and reduces `available` (via `outstanding`).

If the user was **referred by someone**, `/referrals` shows "Invited by …" and hides the
"Have a referral code?" entry (a code can be applied only once).

---

## 6. The admin side

`/admin/referrals` (capability-gated):
- **Referrals list** — every referral with referrer/referred email, status, snapshotted
  reward, qualifying date (`GET /api/admin/referrals`).
- **Program settings** (`/api/admin/referral-settings`) — reward type/percent/amount,
  reward currency, **holding_days**, **min_payout**, and the referral banner.
- **Payout requests** — approve / mark paid / reject (`PATCH /api/admin/payouts/:id`).
  Payouts are a **manual transfer workflow**: the admin sends the money out-of-band (UPI/
  PayPal/bank) and records the status. When a request is marked **`paid`**, every `paid`
  referral for that referrer flips to **`paid_out`** (status-guarded against replays).

---

## 7. Files

| Concern | File |
|---|---|
| Code gen, attribution, crediting, stats (pure-ish) | `api/_lib/referral.ts` |
| User referral page data (code, stats, list, payouts) | `api/_routes/referrals.ts` |
| Apply a code after signup | `api/_routes/referrals/apply.ts` |
| Request a payout | `api/_routes/referrals/payouts.ts` |
| Credit on paid — webhook | `api/billing/webhook.ts` (`payment.succeeded`) |
| Credit on paid — reconcile (the fix) | `api/_lib/billing-sync.ts` (`reconcileInvoices`) |
| Admin referrals list | `api/_routes/admin/referrals.ts` |
| Admin program settings | `api/_routes/admin/referral-settings.ts` |
| Admin payout status | `api/_routes/admin/payouts/[id].ts` |
| Tables | `referral_codes`, `referrals`, `referral_settings`, `payout_requests` (`src/lib/db/schema.ts`) |
| User UI | `src/pages/ReferralPage.tsx`, `src/components/ReferralBanner.tsx` |
| Admin UI | `src/pages/admin/AdminReferralsPage.tsx` |

---

## 8. FAQ (the questions that started this)

**Q: A referred user upgraded but `/referrals` still shows 0 paid.**
That was the bug. Crediting only ran in the `payment.succeeded` webhook; activation runs on
the return-from-checkout reconcile. With webhooks unconfigured, the referral stayed
`signed_up`. **Fixed:** the reconcile path now credits too (idempotently). Use the admin
"Sync from Dodo" on the org's subscription to back-fill any historical case.

**Q: It says paid now, but I can't withdraw.**
Earnings are redeemable only **after the holding period** (`holding_days`, default 14). The
paid count and lifetime earnings show immediately; `available` unlocks at `qualifying_at`.
Admins can lower `holding_days` (and `min_payout`) to test withdrawals sooner.

**Q: Does the referred user need to use a specific upgrade?**
No — any first paid charge on an org the referred user owns (personal or a new
organization) credits the referral.

**Q: Can the same person be referred twice / refer themselves?**
No. `referred_user_id` is unique and self-referrals are ignored.

**Q: What if both the webhook and the reconcile fire for the same payment?**
Only one credit happens — the transition is guarded on `status = 'signed_up'`.
