# Fine-Tuning Wave 2 — Plan & live tracker

This is the single source of truth for the second autonomous fine-tuning wave. It is
executed end-to-end without user intervention, following the `work-finetuning` skill:
research → adversarially verify → plan → implement per stacked branch → gate → verify
→ push → document.

**North star:** simple, lovable, **mobile-first** UX with **correct money/data**. When a
choice isn't specified, optimise for that.

## The brief (7 items, as given)

1. **Modal back/swipe** — when a modal is open and the user swipes/clicks Back, only the
   modal closes; never navigate to a different page. Audit *all* modals.
2. **India card payment** — "Missing connector response" error when paying by card in
   regions like India. Must fix.
3. **Paid referrals** — paid status isn't processed; a referred user's personal upgrade
   ($2.49/mo, $24.99/yr) and org upgrade ($4.99/mo, $49.99/yr) don't show in `/referrals`,
   and the reward can't be redeemed. Fix + write a complete referral document.
4. **Quick-add toast** — creating a client/transaction/quotation from the `+` FAB on any
   screen should show a success toast (name + worth) with a "Click to see" deep link;
   Back returns to the page you were on.
5. **Invitation signup** — an invited user who signs up should skip onboarding and land
   directly on the organization dashboard.
6. **Budget feature** — business: an expense budget per client (incl. own/company) +
   a default for future clients; personal: a single personal budget. Period:
   lifetime/monthly/weekly/daily. Card indication + an indicator while adding an outgoing
   transaction. Also settable during onboarding.
7. **Onboarding step** — after sign-up, an interactive step to add cash balance-in-hand +
   bank accounts (1 for free, unlimited for pro) with balances/details, and to set
   budgets (business: own company + default; personal: personal). All optional.

## Working conventions (this repo)

- **Mobile-first**: design ~390px first; ≥44px touch targets; reuse responsive primitives.
- **Transitions**: animate transform/opacity (or grid `0fr→1fr`); respect
  `prefers-reduced-motion`. Use the `transition-creator` skill for new motion.
- **i18n**: every user-visible string via `useTranslation()`. Add to `en.json` first, then
  propagate to all 7 other locales (`scripts/i18n-merge.mjs`); `npm run i18n:check` gates.
  The `/admin` console is intentionally English-only (no i18n).
- **Scoping**: every API query scoped by `orgId` from `requireAuth()`; `serialize(row)`
  before `res.json`; `.js` import extensions in `api/**`; `canWrite`/`canDelete` + quota
  checks before writes.
- **Money**: `wealth_accounts.current_balance` is STORED; sign logic only via
  `src/lib/wealth-ledger.ts`. Money columns are `numeric(20,2)`; `MAX_MONEY` cap. Never
  ship a balance change reasoned about only — verify by hand + a pure test.
- **Perceived speed**: surgical in-place list updates (no full-screen reload); optimistic
  modal close + rollback (`src/lib/optimistic.ts`); granular cache
  (`src/lib/api.ts#invalidateKeys`); `fetchPage1({silent})` reconcile.
- **Billing invariant**: Dodo is authoritative for money; our DB is a mirror kept fresh by
  webhook + reconcile. Idempotent invoice upsert on the Dodo payment id. See
  `docs/billing/SUBSCRIPTIONS_AND_PAYMENTS.md` + the `subscription-system` skill.
- **Migrations**: `npm run db:generate` → bump the new `_journal.json` `when` above the
  previous (silent-skip gotcha) → apply → confirm the column exists.
- **The gate (husky pre-commit, mirrored in CI)**: `i18n:check → lint → typecheck →
  test:ci`. No `--no-verify`. DB-touching tests are throwaway, never committed.

## Branch chain (live tracker)

Each branch is created **from the previous** (stacked), so later branches contain all
earlier work. Root is `feat/ux2-00-plan` off `dev`.

| # | Branch | Item | Scope | Migration | Status |
|---|---|---|---|---|---|
| 00 | `feat/ux2-00-plan` | — | This plan document | no | ✅ committed |
| 01 | `feat/ux2-01-referrals-paid` | 3 | Credit referrals on reconcile (not just webhook); verify redemption; referral doc | no | ✅ pushed |
| 02 | `feat/ux2-02-india-payment` | 2 | Pass `billing_currency` (IN→INR) + full address to Dodo checkout; document dashboard config | no | ✅ pushed |
| 03 | `feat/ux2-03-modal-back-close` | 1 | `useBackClose` primitive wired into Dialog/Sheet/Drawer/AlertDialog wrappers so Back closes any modal | no | ✅ pushed (Playwright-verified) |
| 04 | `feat/ux2-04-invite-onboarding` | 5 | Auto-accept invitation post-signup; skip onboarding → org dashboard | no | ✅ pushed (typecheck+smoke; full new-user E2E deferred) |
| 05 | `feat/ux2-05-quick-add-toast` | 4 | Global quick-add over current page + success toast "Click to see"; Back returns to origin | no | ✅ pushed (Playwright-verified) |
| 06 | `feat/ux2-06-budgets` | 6 | `budgets` table + API + `src/lib/budget.ts` + client-card, personal-dashboard & outgoing-tx indicators | **yes (0033)** | ✅ pushed (Playwright-verified) |
| 07 | `feat/ux2-07-onboarding-wealth-budget` | 7 | Onboarding step: cash + bank accounts (plan-gated) + budgets; plan-based bank quota (free=1) | no (config-only) | ✅ pushed (Playwright-verified) |
| 08 | `feat/ux2-08-docs-skill` | docs | Budget doc + wave OVERVIEW; subscription/payments skill refresh (India + reconcile referral) | no | ✅ pushed |

Ordering rationale: front-load verifiable, low-risk backend wins (referrals, payment),
then the mechanical cross-cutting modal primitive, then small UX (invite), medium UX
(quick-add, depends on the modal primitive), then the big migration features (budgets →
onboarding), and finally docs/skill.

---

## Item 3 — Paid referrals (branch 01)

**Problem.** A referred user upgrades (personal or a new org) but `/referrals` never shows
the paid status, and the reward can't be redeemed.

**Verified root cause.** `creditReferralOnPaid()` (`api/_lib/referral.ts:69`) is invoked
**only** from the `payment.succeeded` webhook (`api/billing/webhook.ts:176`). The primary
activation path is the return-from-checkout `POST /api/billing/sync` →
`reconcileSubscriptionFromDodo` → `reconcileInvoices` (`api/_lib/billing-sync.ts`), which
records the paid invoice but **never credits the referral**. The billing doc explicitly
says the app *never depends on webhooks* — but referral crediting does. So with webhooks
unconfigured (the test setup the owner used), the referral stays `signed_up` forever even
though the org is `active` and an invoice exists.

**Approach.**
- Add referral crediting to the reconcile path: when `reconcileInvoices` upserts a
  **paid** invoice (status `paid`), call `creditReferralOnPaid(orgId, amount, currency)`.
  It is idempotent (only a `signed_up` referral → `paid`, guarded by a WHERE on status),
  so crediting from both webhook and reconcile is safe.
- Verify attribution: `attributeReferral` runs on first `GET /api/profile`
  (`api/_routes/profile.ts:36`) from Clerk `unsafeMetadata.referralCode`. A new org's
  owner is the referred user → `creditReferralOnPaid` matches by `organizations.owner_user_id`.
- Redemption: `POST /api/referrals/payouts` already validates against server-computed
  `available` (`api/_lib/referral.ts#computeStats`). Once crediting works, `available`
  becomes non-zero after the holding period (`holding_days`, default 14). Note this in the
  doc; consider whether the holding period should be configurable to 0 for testing
  (admin `referral_settings`).

**Files.** `api/_lib/billing-sync.ts` (credit on paid invoice), maybe
`api/_routes/billing/sync.ts`. Pure-logic safety: existing referral logic is idempotent.

**Risks.** Double-credit if both webhook and reconcile fire — mitigated by the status
guard. Crediting on a *renewal* — mitigated (only `signed_up`→`paid`, renewals are already
`paid`). Crediting an admin comp-grant — N/A (no Dodo invoice).

**Verify.** Throwaway DB test that seeds a `signed_up` referral + a `dodo` sub, simulates
a paid invoice reconcile, asserts the referral flips to `paid` once and not twice on a
second reconcile. Delete the test before commit.

**Status:** ⬜ pending.

---

## Item 2 — India card payment (branch 02)

**Problem.** Card payments in India fail with Dodo "Missing connector response".

**Verified root cause.** `create-subscription.ts:114-125` sends `billing.country` (from
`x-vercel-ip-country`, default `US`) but **no `billing_currency`**, while products are
USD-priced. Dodo docs: *"For India-specific payments, the billing country must be set to
`IN` with currency `INR`"*; connectors become unavailable on country/currency mismatch.
An Indian card + `country=IN` + USD txn has no eligible connector → the error.

**Approach.**
- Derive `billing_currency` from the billing country via `COUNTRY_TO_CURRENCY` /
  `currencyForCountry` (`src/lib/currencies.ts`, already importable in `api/**`) and pass
  it into `createSubscription` (thread a `billingCurrency` param through `dodo.ts`).
- Also pass `allowed_payment_method_types` including UPI (`upi_collect`, `upi_intent`) +
  card so Indian users get UPI (RBI-mandate friendly). Adding a method doesn't force it to
  show, so this is safe everywhere.
- Apply the same to `change-plan.ts` if it creates checkout.
- **Document** the Dodo dashboard requirements (enable the India card connector / adaptive
  currency / UPI; in test mode Indian users must use the INR test cards).

**Files.** `api/_routes/billing/create-subscription.ts`, `api/_lib/dodo.ts`
(`createSubscription` body: add `billing_currency`, `allowed_payment_method_types`),
possibly `api/_routes/billing/change-plan.ts`. Doc in `docs/billing/`.

**Risks.** `billing_currency` Dodo can't support → won't proceed; only set it to a
supported ISO currency (all `COUNTRY_TO_CURRENCY` values are in Dodo's list). Don't force
a currency the merchant account can't settle — keep it conservative (derive from country;
fall back to no override on unknown).

**Verify.** Typecheck + unit-test the country→currency mapping helper. Live Dodo card flow
can't be fully exercised locally; document the test-card requirement.

**Status:** ⬜ pending.

---

## Item 1 — Universal modal back/swipe-to-close (branch 03)

**Problem.** Many modals use plain `useState` open state and don't close on browser/OS
Back — so Back navigates away from the page instead of closing the modal. ~35 modal call
sites across pages/components.

**Verified root cause.** Only a few modals use `useUrlModal` (`src/hooks/use-url-modal.ts`)
which pushes a history entry so Back closes them. The rest don't participate in history.

**Approach (lowest-risk uniform).**
- Add `src/hooks/use-back-close.ts#useBackClose(open, onClose)` — on `open`,
  `window.history.pushState({__modal:true}, "")` (same URL, dummy entry); add a `popstate`
  listener that calls `onClose`; on programmatic close, if our dummy entry is still on top
  (`history.state?.__modal`) call `history.back()` to consume it. Keep `onClose` in a ref
  and depend only on `[open]` so the effect doesn't re-push on every render.
  > ⚠️ **Correction (research agent was wrong):** the agent suggested "don't touch history,
  > just close on popstate." That does NOT work — without a pushed entry, Back pops the
  > page entry and navigates away before anything can intercept. Pushing a dummy entry on
  > open is mandatory (this is exactly what the working `useUrlModal` does via `navigate`).
- **Wire it into the 4 vendored shadcn Root wrappers** (`src/components/ui/{dialog,sheet,
  drawer,alert-dialog}.tsx`) by making each `Root` *internally controlled* (mirror
  open state via `onOpenChange` whether controlled or uncontrolled) and calling
  `useBackClose(actualOpen, () => setOpen(false))`. This guarantees **every** modal in the
  app (all ~35 call sites, controlled *and* trigger-based) closes on Back with zero
  per-site edits. A small, well-commented enhancement to the Root only — documented as an
  intentional exception to "don't edit `ui/*`" (re-running the shadcn CLI would need a
  re-apply; noted inline).
- Don't double-handle `useUrlModal`-driven modals: `useUrlModal` already pushes its own
  history entry via `navigate`. Add a `disableBackClose` opt-out prop on the Root wrappers
  and set it on the few URL-driven modals (TransactionsPage `?view=`, WealthAccountDetail),
  so they don't get a second entry. Verify on Playwright that one Back press closes each
  and the path is unchanged.

**Files.** New `src/hooks/use-back-close.ts`; wrappers around `src/components/ui/{dialog,
sheet,drawer,alert-dialog}.tsx` (a sibling component, not an edit to the vendored file) or
targeted call sites. (Finalised after the research agent's modal inventory.)

**Risks.** Double-push / popstate races; interaction with `useUrlModal`; nested modals;
react-remove-scroll portal scroll (see `popover-scroll-in-dialog` memory).

**Verify.** Playwright: open each major modal, press Back, assert the modal closed and the
URL/path is unchanged.

**Status:** ⬜ pending.

---

## Item 5 — Invitation signup → skip onboarding (branch 04)

**Problem.** A newly invited user who signs up sees the onboarding screen instead of the
org dashboard.

**Verified root cause.** The accept route already stamps `onboarded_at`
(`api/_routes/invitations/[token].ts:87-110`), but acceptance requires a **manual click**,
and any path that reaches an app route before accepting (`needsOnboarding` true in
`org-context.tsx:109` → AppLayout redirect to `/onboarding`) shows onboarding.

**Approach.** Auto-accept the invitation when a signed-in user with the **matching email**
lands on `/invitations/:token` for a still-pending invite (show a brief "Joining…" state),
then route to `/dashboard` for the joined org. Keep the manual decline. Don't regress
already-onboarded users accepting a 2nd invite. Ensure no `/onboarding` flash.

**Files.** `src/pages/InvitationPage.tsx` (auto-accept on land), possibly `SignupPage.tsx`
(redirect robustness), no API change needed (accept already stamps `onboarded_at`).

**Risks.** Auto-accepting an invite the user wanted to decline — mitigate by only
auto-accepting when arriving with the matching email and showing what happened with an
undo/leave affordance is out of scope; a clear toast suffices.

**Verify.** Playwright on a disposable invited test account if reachable; else typecheck +
careful review (note in the doc).

**Status:** ⬜ pending.

---

## Item 4 — Quick-add toast (branch 05)

**Problem.** The FAB navigates to `/section?new=1`, yanking the user to another page. The
user wants to create from any screen and get a success toast with a "Click to see" deep
link, with Back returning to the origin page.

**Approach (finalised after research).** Prefer a **global quick-add overlay** rendered at
the layout level that hosts the create form over the current page (no navigation), then
toasts on success with a deep link; OR keep the `?new=1` navigation but, after success,
toast with the deep link and ensure Back returns to origin. Reuse existing page create
dialogs where possible. Toast content: client → name; transaction → type + amount +
client; quotation → title + amount.

**Files.** New `src/components/QuickAddModal.tsx` (lightweight create forms for
client/transaction/quotation); `AppLayout.tsx` + `MobileAppLayout.tsx` wire the FAB
quick-actions menu to open it in place (instead of `navigate(?new=1)`); 4 new `quickAdd.*`
i18n keys (8 locales). Builds on branch 03 (the modal closes on Back).

**Decision.** Rather than risky extraction of the complex page create-forms, the FAB
quick-add uses a dedicated lightweight modal (minimal fields; power features stay on the
full pages). It opens over the current page (no navigation), and on success toasts
"<entity> added" with a "View" deep link. The per-section FAB (on /clients, /transactions,
…) keeps its existing full-create dialog.

**Verified (Playwright).** From /dashboard and /wealth: FAB → Add Transaction/Add Client
opens the modal with the path unchanged; submitting creates the row (confirmed in the DB/
list), closes the modal, and fires the success toast — captured live:
`Client "ZZZ Toast Two" added` + a **View** action. Test data cleaned up.

**Status:** ✅ pushed (Playwright-verified).

---

## Item 6 — Budget feature (branch 06)

**Problem/Goal.** Per the brief: business per-client (incl. own) + default budget;
personal single budget; period lifetime/monthly/weekly/daily; card indication + outgoing
tx indicator.

**Design (draft, finalised after research).**
- New `budgets` table: `organization_id` (FK), `client_id` (nullable — null = personal
  budget for personal orgs, or the business default for future clients), `is_default`
  (business default-for-future-clients), `period` (lifetime|monthly|weekly|daily),
  `amount numeric(20,2)`, `currency`, timestamps. One budget per (org, client) and one
  default per org.
- `src/lib/budget.ts` (pure): current-period window (day/week[Mon]/month/lifetime),
  `spent` from outgoing `standard` non-deleted transactions, status under/warn/over with
  thresholds.
- API `api/_routes/budgets.ts` (+ `[id]`) GET/POST/PATCH/DELETE, orgId-scoped, account-type
  gated; GET returns budgets joined with computed `spent` for cards.
- UI: progress/indicator on the client card + client detail, and in the outgoing
  transaction form (remaining/over preview as the amount is typed).
- Gating: business = per-client + default; personal = single. Use `accountTypeAllows` /
  `organizations.account_type`.

**Migration:** yes (new table). i18n: yes.

**Risks.** Period window correctness (timezone, week start); default-vs-explicit
resolution; performance of spent computation on big tx tables (index on
`client_id, type, date`).

**Status:** ⬜ pending.

---

## Item 7 — Onboarding wealth + budget step (branch 07)

**Problem/Goal.** Add an optional onboarding step: cash balance-in-hand + bank accounts
(1 free / unlimited pro) with balances + minimal details, and budgets (business: own
company + default; personal: personal).

**Design (draft, finalised after research).**
- Insert a step between account-type (step 1, which already stamps `onboarded_at` and
  creates the org via `/api/onboarding`) and the plan step. All inputs optional.
- Cash: set the auto-provisioned Cash account's balance (PATCH/adjust) or post an opening
  balance. Bank accounts: POST `/api/wealth/accounts` (auto-posts an opening-balance
  system tx). Gate bank count to the FREE limit (1) during onboarding (user hasn't paid).
- Replace the hardcoded `MAX_BANK_ACCOUNTS = 5` (`api/_routes/wealth/accounts.ts:10`)
  with a plan-based `bankAccounts` quota (free 1 / premium unlimited) in `api/_lib/quota.ts`
  + a `checkBankAccountQuota` enforced on create.
- Budgets: reuse branch 06's budget API.

**Migration:** yes (PlanLimits `bankAccounts` is config, but if persisted in `plans.limits`
no schema change; the quota default is code). Likely **no schema migration** beyond
budgets; confirm. i18n: yes.

**Risks.** Tightening free bank limit 5→1 affects existing free users — only blocks *new*
creates beyond the limit (existing accounts grandfathered). Onboarding best-effort POSTs
must not block completion on failure.

**Status:** ⬜ pending.

---

## Item — Docs + skill (branch 08)

- `docs/referrals/REFERRALS.md` — complete referral system explainer (users + admins):
  how attribution works, signup→paid→qualifying→available→payout lifecycle, reward types
  (fixed/percent), holding period, redemption methods, admin approval, and the
  reconcile-credits-too fix.
- `docs/budget/BUDGETS.md` — the budget model, periods, indicators, onboarding.
- Refresh `docs/billing/SUBSCRIPTIONS_AND_PAYMENTS.md` + the `subscription-system` skill
  with the India `billing_currency` fix and the reconcile-side referral crediting.

**Status:** ⬜ pending.

---

## Change log

- _(wave start)_ — Recon complete; research workflow launched; chain-root branch
  `feat/ux2-00-plan` created off `dev`; this plan committed.
- **01** referrals — credit on the reconcile path (not only the webhook); idempotent;
  `docs/referrals/REFERRALS.md`. DB-test verified.
- **02** India payment — `billing_currency` from billing country + full address into the
  Dodo checkout; dashboard config documented (§11). Mapping locked by `currencies.test.ts`.
- **03** modal back-close — `useBackClose`/`useModalBackClose` in the 4 shadcn Roots;
  `disableBackClose` opt-out for URL modals. **Playwright-verified.** ⚠️ Correction logged:
  the history entry MUST be pushed (the research agent's "don't touch history" was wrong).
- **04** invitation — auto-accept on land for a matching signed-in email → dashboard, no
  onboarding flash. typecheck + smoke verified.
- **05** quick-add — `QuickAddModal` over the current page + success toast w/ "View".
  **Playwright-verified** (toast captured via MutationObserver).
- **06** budgets — `budgets` table (mig 0033), `src/lib/budget.ts` (+13 tests),
  `api/_routes/budgets.ts`, indicator/dialog/personal-card, card + tx-form hints.
  **Playwright-verified** (€500 budget → card bar; €600 expense → "€100 over").
- **07** onboarding — step 2 (cash + bank + budgets); plan-based bank quota (free=1).
  **Playwright-verified** (bank created via onboarding, DB-confirmed).
- **08** docs/skill — `docs/budget/BUDGETS.md`, `docs/finetuning2/OVERVIEW.md`,
  `subscription-system` skill refreshed (India + reconcile-referral notes).
- **09** onboarding wizard + new-org setup (follow-up) — split step 1 (type →
  Continue → then currency/company), converted "Setup money" into a one-question-at-a-time
  **mobile-first wizard** (cash → bank → budget, animated slide, progressive-disclosure
  default budget). Extracted reusable `MoneyWizard` + `PlanStep` + `OnboardingShell`.
  **Creating a new organization** now runs the same setup (`/organization-setup`:
  money wizard + plan/upgrade) instead of dropping onto an empty dashboard. Cash step
  made robust (PATCH the existing Cash account, not a failing 2nd POST). Skills used:
  `ui-ux-pro-max` + `transition-creator`. **Playwright-verified at 390px** across every
  screen; data confirmed in DB; test data cleaned up.
