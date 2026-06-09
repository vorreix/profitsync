# Fine-Tuning Wave 2 — What changed & how it works

A single, readable overview of everything shipped in this wave. Each section says **what
the user reported / wanted**, **what we did**, **how it works**, and **where the code
lives** — so anyone (engineer or not) can understand it. Deeper docs are linked per topic.

Shipped as a chain of stacked branches off `dev` (`feat/ux2-00-plan` →
`feat/ux2-08-docs-skill`); the live tracker is in `PLAN.md`.

---

## 1. Modals close on Back / swipe — never leave the page

**Wanted:** when a modal is open and you press Back (or edge-swipe on mobile), only the
modal should close; the app must stay on the same page.

**What we did:** every modal in the app now closes on the Back gesture without navigating
away. Pressing Esc / clicking outside / Save / Cancel all behave as before.

**How it works:** a hook `useBackClose(open, onClose)` (`src/hooks/use-back-close.ts`)
pushes a single dummy entry into the browser history when a modal opens (keeping the same
URL, so the page never changes). Back pops that entry and closes the modal; a normal close
cleans the entry up. It's wired into the four shadcn modal primitives
(`dialog`/`sheet`/`drawer`/`alert-dialog`), so **all ~35 modals** get it automatically.
URL-driven modals (which already manage history) opt out with `disableBackClose`.

**Verified** in a real browser: open a dialog → Back closes it, URL unchanged; Esc closes
cleanly with no stray history entry.

---

## 2. Card payments work in India (and other regions)

**Reported:** paying by card in India failed with Dodo "Missing connector response".

**What we did:** the hosted checkout now bills the customer in **their local currency**, so
the charge routes to a payment connector that can actually process their card (India → INR,
which supports card + UPI with RBI mandates).

**How it works:** `create-subscription` resolves the billing country (your saved profile
country → IP geo → US) and derives `billing_currency` from it (`currencyForCountry`,
IN→INR), passing it plus your full billing address to Dodo. We deliberately don't restrict
payment methods (that would hide valid ones like iDEAL/SEPA elsewhere). **Note:** the Dodo
dashboard must also have the region's connector / adaptive currency enabled, and in test
mode the test card must match the billing country. Details + test cards:
`docs/billing/SUBSCRIPTIONS_AND_PAYMENTS.md` §11.

---

## 3. Paid referrals are credited (and can be redeemed)

**Reported:** a referred friend upgraded (personal and org), but `/referrals` never showed
the paid status, and the reward couldn't be redeemed.

**What we did:** a referred user's first paid upgrade now reliably flips the referral to
**paid** and shows up in the referrer's stats.

**How it works:** the bug was that crediting only ran inside the `payment.succeeded`
webhook — but the app activates subscriptions via the return-from-checkout **reconcile**
(it never depends on webhooks). So with webhooks unconfigured (the common test setup), the
upgrade activated but the referral stayed `signed_up`. We now also credit on the reconcile
path (`reconcileInvoices`), idempotently (only `signed_up → paid`, so it can't
double-credit). Redemption already worked; earnings become withdrawable after the holding
period (default 14 days — admins can lower it to test). Full lifecycle + admin payout flow:
`docs/referrals/REFERRALS.md`.

---

## 4. Quick-add from any screen + a success toast you can tap

**Wanted:** adding a client/transaction/quotation from the **+** button on any screen
should show a success toast (with the name/amount) and a "View" link; pressing Back after
that returns to the page you were on.

**What we did:** the **+** quick-actions now open a lightweight create form **in place**
over the current page — no navigation. On success you get a toast like *"Client "Acme"
added"* with a **View** action that jumps to the new item; Back returns you to where you
were. Power features (splits, attachments) still live on the full section pages.

**Where:** `src/components/QuickAddModal.tsx`, wired into the FAB in `AppLayout.tsx` and
`MobileAppLayout.tsx`. **Verified** in-browser end to end.

---

## 5. Invited users skip onboarding → straight to the dashboard

**Wanted:** when someone you invite signs up, they shouldn't see the onboarding screen —
they should land directly on the organization's dashboard.

**What we did:** an invited, signed-in user with the matching email now **auto-joins** when
they open the invitation link (a brief "Joining…" state) and goes straight to the org
dashboard. Accepting marks them onboarded server-side, so the onboarding screen never
appears. If anything fails, the manual Accept/Decline buttons remain as a fallback.

**Where:** `src/pages/InvitationPage.tsx` (the accept route already stamped `onboarded_at`).

---

## 6. Budgets (expense targets) with live indicators

**Wanted:** business accounts set a budget per client (incl. their own company) + a default
for future clients; personal accounts set a personal budget. Periods:
lifetime/monthly/weekly/daily. The card shows an indication, and you see the impact while
adding an outgoing transaction. Settable during onboarding too.

**What we did:** a full expense-budget system. Set a budget (amount + period) on any client
card or the personal dashboard; the card shows a progress bar ("€X left / over"); while
adding an outgoing transaction you see "€X left / over budget after this expense". Full
explainer: `docs/budget/BUDGETS.md`.

**Where:** `budgets` table (migration 0033), `src/lib/budget.ts`, `api/_routes/budgets.ts`,
`src/components/budget/*`, wired into `ClientsPage`, `Dashboard`, and the transaction forms.

---

## 7. Onboarding: add balances & budgets up front

**Wanted:** after sign-up, an interactive step to add your cash balance-in-hand and bank
account(s) (1 on Free, unlimited on Pro) with balances, then set budgets (business: company
+ a default for new clients; personal: a personal budget). All optional.

**What we did:** onboarding is now 3 steps — account type → **money setup** → plan. The new
step lets you add cash, a bank account, and budgets, all optional with "Skip for now".
The bank-account limit is now **plan-based** (Free = 1, paid = unlimited), enforced
server-side. Everything is best-effort, so you always reach the plan step.

**Where:** `src/components/onboarding/WealthBudgetStep.tsx` (+ `OnboardingPage.tsx`),
`PlanLimits.bankAccounts` + `checkBankAccountQuota` in `api/_lib/quota.ts`. **Verified**
in-browser: a bank account entered during onboarding was created (free quota honored).

---

## Cross-cutting notes

- **i18n:** every user-visible string is translated across all 8 locales (the pre-commit
  gate enforces parity). Admin pages remain English-only by design.
- **Quality gate:** every branch passed `i18n:check → lint → typecheck → test:ci` before
  push; money/correctness paths were verified with throwaway DB tests (never committed) and
  the UX flows with Playwright.
- **Docs & skill:** `docs/referrals/REFERRALS.md`, `docs/budget/BUDGETS.md`,
  `docs/billing/SUBSCRIPTIONS_AND_PAYMENTS.md` (§11 added), and the `subscription-system`
  skill (refreshed) cover the billing/referral/budget systems for future work.
