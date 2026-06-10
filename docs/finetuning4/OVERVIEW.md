# ProfitSync — Fine-Tuning Wave 4 (ux4): the complete explainer

> Written for anyone — a new developer, an admin, or a non-technical owner.
> Each section answers: what changed, why, how it works, and how to operate it.
> The engineering tracker (per-branch verification evidence) is
> [`PLAN.md`](./PLAN.md); the audit report is [`AUDIT.md`](./AUDIT.md).

The wave shipped as **14 stacked branches** — `feat/ux4-00-plan` …
`feat/ux4-13-docs-skill` — each off the previous, each gated by
secret-scan → i18n → lint → typecheck → tests before push. Merge them in order.

---

## 1. Bank logos that never disappear (`ux4-02`)

**The problem.** Picking a bank logo worked, but hours later the logo vanished
in production. The image bytes were already being copied into our database —
the UI just never used them; it kept rendering the hotlinked CDN URL, which
expires.

**How it works now.** The API returns each account with a `logo_src` — a
self-contained `data:` URL built from the bytes stored in
`wealth_accounts.logo_data`. The mime type is detected from the bytes
themselves (`src/lib/logo-data.ts`, unit-tested), never from a header. Accounts
whose bytes were never captured heal themselves: the next list request
re-downloads up to 3 missing logos and stores them. Display order:
stored bytes → remote URL → bank glyph. Security hardening from the audit: SVG
is refused end-to-end (a script-capable format), and inline payloads are capped
at ~128KB so lists stay light.

**Operating it.** Nothing to do. `BRANDFETCH_APIKEY` improves logo quality but
everything degrades gracefully to free favicon services without it.

## 2. Organization logos & profile photos (`ux4-04`)

Upload a logo per organization (Organizations → ✎ Edit) and a profile photo
(Profile page). They appear in the org switcher, organization cards and the
user menus on desktop + mobile. Images are resized **in the browser** to ≤256px
WebP before upload (a phone photo becomes ~10–30KB), and the server
re-validates: 300KB cap, base64 sanity, and the type derived from the bytes
(PNG/JPG/WebP/GIF only). Stored in `organizations.logo_data` /
`user_profiles.avatar_data` (migration 0036) and served as data URLs.

## 3. Recurring payments (`ux4-07`)

**What.** "Recurring" in the nav (desktop sidebar + mobile More). A rule says:
name, money in or out, amount, who it belongs to (your company or a specific
client — personal workspaces skip this), which account it moves money through
(Cash in Hand or a bank), repeats every N days/weeks/months/years, starts on a
date, optionally ends on a date. When an occurrence falls due, **a real
transaction is created automatically** and shows a violet ↻ *Recurring* badge in
every list and in the detail view.

**How it stays correct (the important part).**
- Occurrence dates are computed from the rule's anchor date
  (`src/lib/recurring.ts`, 13 unit tests) — Jan 31 monthly gives
  Feb 28 → Mar 31, no drift; leap years handled.
- The materializer (`api/_lib/recurring-materialize.ts`) runs lazily whenever
  transactions/wealth/calendar data is read (an indexed no-op when nothing is
  due — **no cron needed**) and is race-proof: a unique index on
  (rule, due-date) means even two simultaneous requests create each occurrence
  **exactly once**, and the account balance moves **only** for rows actually
  inserted. This was proven against the real database with two deliberately
  racing runs.
- A backdated start date intentionally back-fills the missed payments at
  creation (the form warns you); editing a schedule is forward-only.
- Deleting a generated transaction is **final** — re-enabling the rule will not
  re-charge it (deliberate; see AUDIT.md).
- Rules that can't run (plan quota reached, archived account) pause themselves
  and show a ⚠ with the reason instead of corrupting data.

## 4. Money calendar (`ux4-08`)

"Calendar" in the nav. Month grid (dots sized by that day's activity, today
ringed), Week strip with per-day totals, and Day view; the header cards show the
period's money in / money out / count. Tapping any day (or a summary card)
opens a modal listing that period's transactions; **Open in Transactions**
lands on the Transactions page pre-filtered to those dates (the page now reads
`?from=…&to=…` URL parameters). Backed by `GET /api/calendar` returning per-day
sums — recurring occurrences are materialized first so the view is truthful.

## 5. Customizable dashboard (`ux4-09`)

Press the ⚙ button (desktop) or **press-and-hold any card** (mobile, half a
second) to enter edit mode. Drag the handle pill to reorder, ✕ to hide, tap a
hidden-card chip to bring it back, with Undo/Redo and a sticky Save/Cancel bar
(cancelling with unsaved changes asks first). Layouts are saved per workspace
type — your personal dashboard and your business dashboard remember their own
arrangements — in `user_profiles.dashboard_layout` (migration 0040) with a
localStorage fast-path, and survive sign-out/sign-in. Unknown card ids from
older/newer app versions are dropped safely; new cards appear at the end.

## 6. Free-plan bank limit & default account (`ux4-03`)

At the free plan's bank allowance the Add-bank button shows a **golden crown**
and opens an upgrade dialog (with the plan's real limit) instead of a form that
would only fail. The client learns the allowance from `GET /api/wealth/quota`.
Any active account can be marked **Default** (card menu → Set as default):
exactly one default exists per workspace (database-enforced), setting a new one
clears the previous automatically, and transaction forms pre-select it
(default → Cash → first).

## 7. Checkout in the organization's currency (`ux4-05`)

Checkout charges in the **organization's currency** when Dodo can route it.
The resolution chain (`src/lib/billing-currency.ts`, 10 unit tests):

1. Org currency == billing-country currency → use it.
2. Billing country is **India → always INR** (card/UPI connectors fail at
   *payment* time otherwise — this preserves the earlier India fix).
3. Org currency is Dodo-supported → use it.
4. Otherwise → the country's currency, ultimately USD.

If Dodo rejects a create call, the server retries down the chain — a currency
preference can never break checkout. The currency actually used is snapshotted
on `subscriptions.billing_currency` (migration 0037); `invoices.currency`
remains the source of truth for what was charged. Verified live on test-mode
Dodo: a EUR organization saw a **€**-priced hosted checkout.

## 8. Billing attempts — the admin funnel (`ux4-06`)

Every click of a paid-plan subscribe button writes a row to
`billing_attempts` (migration 0038): who, which org/plan/cycle/currency, and the
outcome — `created → redirected → completed | failed` (stale in-flight attempts
read as `abandoned` after 24h, computed at read time). Dodo errors are captured
verbatim; `payment.failed` webhooks attach their full payload for forensics.
Logging is non-fatal by design — it can never break a payment.

**Admin → Billing attempts**: funnel chips (All/Created/Redirected/Completed/
Failed/Abandoned), search, plan filter, pagination; click a row for the full
detail (raw webhook payload included) and set a follow-up status
(*contacted / resolved / paid later*) plus free-text notes.

## 9. Instant category updates (`ux4-01`)

Deleting a category previously *looked* broken: the server re-seeded the 11
default category names on every read, resurrecting deleted defaults. Seeding now
happens only on first access, and create/rename/delete update the list
optimistically in place (no reload, with rollback on failure) on both the
Categories page and the inline picker.

## 10. End-to-end tests in CI (`ux4-10`)

`e2e/` holds a 10-test Playwright smoke suite: sign-in, dashboard, wealth,
client creation, transaction creation (through the real dialog), calendar,
recurring, subscription, a mobile-viewport shell test, and a cleanup spec.
Sign-in is programmatic via `@clerk/testing` (Clerk's bot protection blocks UI
automation by design): password first factor + the email-code **second** factor
using Clerk's fixed test code 424242; the test user is provisioned through the
Backend API and onboarded through the same `/api/onboarding` the wizard calls.

`.github/workflows/e2e.yml` gates **every PR to main** (plus on-demand runs via
*workflow_dispatch* from any branch). Set these repository secrets first:
`E2E_VITE_CLERK_PUBLISHABLE_KEY`, `E2E_CLERK_SECRET_KEY` (Clerk dev instance),
and `E2E_DATABASE_URL` — a **dedicated** Neon branch, never production
(migrations run against it on every job). Locally: `npm run e2e`
(or `PLAYWRIGHT_BASE_URL=http://localhost:5175 npm run e2e` against a running
dev server).

## 11. Security gate (`ux4-11`)

- **Pre-commit**: `scripts/secret-scan.mjs` scans the staged diff for real
  credentials (curated patterns; gitleaks used automatically when installed)
  *before* anything else runs. A planted key demonstrably blocks the commit.
  Known-safe examples take a `secret-scan:ignore` comment.
- **CI** (`.github/workflows/security.yml`, every PR + main/dev push): full-tree
  secret scan, a sweep asserting every API handler authenticates (public routes
  are an explicit reviewed allowlist) and that raw-HTML injection stays inside
  the vendored UI components, and `npm audit` (production deps, high+).
- **`SECURITY.md`**: threat model, control inventory, rotation runbook.
- First run found real issues: a committed scratch file containing a session
  token (removed) and a high-severity ORM advisory (upgraded).

## 12. Deep audit (`ux4-12`)

Six audit lenses ran across the finished code, and **every finding was
adversarially re-verified by an independent pass trying to refute it**:
36 raw findings → 13 confirmed → 8 fixed (org-scoping defense-in-depth, SVG
exclusion, webhook replay window, three missing database indexes for scale,
money-cast hardening, search-wildcard escaping, payload caps, timeout cuts) and
5 consciously accepted with written rationale. 23 claims were refuted — the
write-up of *why* they were wrong is as valuable as the fixes. See
[`AUDIT.md`](./AUDIT.md).

---

## Environment variables (new/changed in this wave)

| Variable | Purpose |
|---|---|
| `BRANDFETCH_APIKEY` | optional — richer bank-logo search |
| `E2E_VITE_CLERK_PUBLISHABLE_KEY` / `E2E_CLERK_SECRET_KEY` / `E2E_DATABASE_URL` | GitHub Actions secrets for the e2e gate |
| `E2E_CLERK_EMAIL` / `E2E_CLERK_PASSWORD` | optional local overrides for the e2e account |

## Migrations shipped (apply in order; auto-run on deploy)

0035 default bank · 0036 org logo + avatar · 0037 billing currency snapshot ·
0038 billing attempts · 0039 recurring rules + tx markers · 0040 dashboard
layout · 0041 transactions hot-path indexes.

## Runbooks

- **A bank logo looks wrong/missing** → open the account list once (lazy heal
  re-fetches bytes); if the brand's CDN is gone entirely the glyph fallback is
  expected.
- **A recurring rule stopped firing** → the rules list shows a ⚠ with the exact
  reason (quota reached / account archived); fix the cause, the next read
  catches up automatically (capped at 60 occurrences per pass, cursor resumes).
- **A customer says payment failed** → Admin → Billing attempts: filter Failed,
  open the row, read the provider error + raw webhook payload, record follow-up.
- **Checkout shows the wrong currency** → check the org's currency
  (Organizations → edit) and remember the India-always-INR rule; the snapshot
  on the subscription row shows what was actually sent.
