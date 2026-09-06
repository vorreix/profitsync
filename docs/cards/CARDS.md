# Wealth & Cards

> How ProfitSync models a **card** (debit or credit) on top of the wealth
> ledger, why a card never holds money, how autopay records a statement
> payment exactly once, and the invariants every future change must keep.
> Companion to `src/lib/cards.ts` (pure helpers), `api/_lib/cards.ts`
> (attribution + loading), `api/_lib/card-autopay.ts` (the sync engine) and
> `docs/credit-cards/CREDIT_CARDS.md` (the liability model this builds on).

## 1. What a card is

A card is **identity + attribution linked to a bank**. It never holds money:

| Card | `cards.account_id` (the ledger account it posts to) | `cards.funding_account_id` |
|---|---|---|
| **Debit** | the linked **bank** — a purchase is an ordinary outgoing on that bank | — |
| **Credit** | its own **liability account** (`wealth_accounts.type='credit_card'`, signed balance, limit, statements — unchanged from CREDIT_CARDS.md) | the bank that pays the statement (default "Pay from", autopay source); optional |

`transactions.card_id` and `recurring_rules.card_id` record **which card paid**.
They are attribution only: balances stay keyed by `wealth_account_id`, every
aggregate (analytics, calendar, flow, budgets, `api/_lib/tx-sql.ts`) is
untouched, and deleting a card `SET NULL`s the history rather than losing it.

The one invariant every write path enforces — `api/_lib/cards.ts attributeCard`:

1. a card named → the money lands on **that card's own account** (400 if the
   caller says otherwise) and the card must be usable (not closed; not frozen
   unless the row is a payment);
2. no card, but the account is a credit card's liability account → the row
   carries **that credit card** (the card IS the account, 1:1 — enforced by the
   partial unique index `cards_credit_account_unique`); this covers legacy
   callers (AI quick-add, system rows, the old account routes) and the
   migration backfill;
3. otherwise: plain account, no card.

Applied by `POST /api/transactions`, `/group` (per allocation), `PATCH /:id`
(the pair moves together: a new account without a card re-derives; a card
named on its own moves the row to its bank), recurring create/edit, the
materializer (copies `card_id` onto every occurrence) and transfers (the
incoming leg of a card payment carries the credit card; `from_card_id` puts a
debit card on the outgoing leg).

## 2. Status and lifecycle

| status | meaning | who | effect |
|---|---|---|---|
| `active` | usable | — | offered in every "Pay with" picker |
| `frozen` | lost card, temporary block | canWrite | no new purchases (server 400, pickers hide it); **payments still allowed** (a freeze blocks spending, not paying what is owed); recurring rules on it **pause** with `last_error` and resume on unfreeze; autopay keeps running |
| `closed` | archived | canDelete | hidden; history keeps its chips; a credit card's liability account is archived with it |

The stored value is only half the truth: the API **derives** `closed` whenever
the ledger account is archived (`effectiveCardStatus`), so the plan quota
(which counts accounts) and every picker agree. Closing a credit card that
still owes money is refused (409 `card_has_debt`) — nothing could ever pay it
afterwards. Reopening a credit card restores its account and re-checks the
credit-card quota (402 → upgrade).

Bank archive/delete (`/api/wealth/accounts/:id`): debit cards on the bank are
closed, credit cards it pays get `autopay=false`; a bank with any card is
**archived, never hard-deleted** (a hard delete would cascade the user's card
identities away). A debit card is hard-deleted only while nothing — trashed
rows included — refers to it; otherwise it is closed. Re-linking a debit card
to another bank is allowed only while it has no history (409
`card_has_history`).

## 3. Autopay

Opt-in per credit card (`autopay`, needs `funding_account_id`). ProfitSync is
"manual tracking only": autopay **records** the payment the user says their
bank makes; it never moves real money, so it is OFF by default.

`api/_lib/card-autopay.ts syncCards(orgId)` runs on every card read
(`GET /api/cards`, `/api/cards/:id/summary`, `/api/wealth/accounts`,
`/api/transactions`) and from the notification tick (`api/_routes/cron/notifications.ts`)
so a card nobody opens still pays on time:

1. **File statements** (`ensureStatements`) and announce the newest one filed.
   Filing never starts before the day the card was added — a close that fell
   between an old known statement and onboarding cannot be reconstructed and is
   not filed as a phantom €0 statement.
2. **Pay the NEWEST due, eligible statement only** (`src/lib/cards.ts autopayPlan`).
   A later statement's balance already contains every older unpaid amount
   (FIFO, CREDIT_CARDS.md §2.3), so paying each due statement would pay the
   same debt twice; older due statements are marked `skipped`
   ("superseded"). Eligible = autopay on + funding bank + card not closed +
   `remaining > 0` + never attempted + `due_date > autopay_since` (a statement
   already due when autopay was switched on may have been paid at the bank —
   it stays the user's to settle).
3. The payment is a real bank→card **transfer** through the same helper the
   Pay-card sheet uses (`api/_lib/wealth-accounts.ts createTransfer`), **dated
   today** (always after every filed close, so every statement sees it),
   **clamped** to what the card owes (`autopayAmount`), attributed to the card's
   owner (never the reader who triggered the sync), labelled
   "Autopay: card payment … (statement due …)" and badged *Autopay* in lists.

Exactly-once under Neon HTTP (no interactive transactions):

- pre-claim skips (funding bank missing/archived, nothing owed) leave the
  statement untouched, notify once per cause, retry next run;
- the statement is **claimed** with one conditional UPDATE
  (`autopay_status: NULL → 'processing'`); only the winner moves money;
  `remaining` is recomputed **after** the claim so a manual payment landing in
  between is respected;
- legs + both balance updates + the `'paid'` mark are **one atomic batch**
  (`dbBatch`); a 402/400 from the transfer (free-plan quota) releases the claim
  and defers; a thrown batch → `'failed'` (never retried automatically —
  retrying an unknown failure is how money moves twice); a `'processing'`
  claim older than 10 minutes with no transfer is a crash between claim and
  batch → flipped to `'failed'` and notified.

`autopay_status` machine: `NULL → processing → paid | failed`, or `skipped`.
Trashing the autopay transfer leaves the statement's derived `remaining` (the
truth) and the `paid` mark (the history) both visible — the UI says so.

Time is the UTC day (`todayIso`), like recurring rules.

## 4. Notifications (`api/_lib/notify-cards.ts`, category `cards`, push on by default)

| type | when | dedupe |
|---|---|---|
| `card_statement_ready` | the newest statement a sync filed (balance > 0) | per statement |
| `card_payment_due_soon` | unpaid, due within 3 days, not covered by autopay | per statement |
| `card_payment_overdue` | remaining > 0 after the due date | per statement |
| `card_autopay_paid` / `card_autopay_failed` | the autopay outcome | per statement (+ cause) |
| `card_utilization_high` | ≥ 90 % of the limit | per card per open cycle |
| `card_expiring` | within 30 days of the expiry month's end | per card per expiry |

Recipients: owner/admin/editor. Links open `/wealth/cards/:id`.

## 5. Visual identity

`src/lib/cards.ts resolveCardPalette` decides the colours: a custom design
wins; gold/platinum/metal/black are fixed metallic looks (dark ink on gold and
platinum — white on gold fails contrast); "standard" wears the bank's brand
colour from Brandfetch's Brand API (`api/_lib/bank-brand.ts fetchBrandPalette`,
snapshotted on `cards.brand_colors` at create, fail-soft, per-process cache),
else the curated table (`CURATED_BANK_COLORS`, ~90 banks across IN/IT/DE/UAE/
UK/US), else a neutral navy. Text colour always comes from `readableTextOn`.
Only the **last 4 to 6 digits** are ever stored (`CARD_TAIL_MIN`/`CARD_TAIL_MAX`,
DB CHECK from migration 0064; the column is still called `last4`): a truncated
tail that cannot be expanded into a card number, just enough to tell two cards
apart. `maskedTail()` and `maskedNumber()` are the only formatters — a 6-digit
tail renders as "•••• •••• ••12 3456". The wordmark URL is a Brandfetch CDN
hotlink; the visual falls back to the bank's stored icon + name when it fails.

`BRANDFETCH_APIKEY` (server-only env) enables both the search autocomplete and
the palette. Brand API calls are metered separately from search.

## 6. UI

- `/wealth` = Banks; `/wealth?tab=cards` = Cards (a query param, replace-
  navigation: the mobile shell keys pages by pathname, so no remount and no
  history spam). `/wealth/cards/:cardId` is the card page; `/wealth/:id` for a
  credit-card account forwards there (the account GET returns `card_id`).
- The add-card wizard (`src/components/cards/AddCardWizard.tsx`): Card →
  Look → (credit) Credit details, with a live `CardVisual` preview and an
  inline "Add a bank". The card page: visual + `CreditCardPanel` / debit
  spending + Autopay panel + actions + the card's transactions
  (`GET /api/transactions?cardId=` — flat, transfers included, like an
  account list) + upcoming rules.
- Every transaction list shows `CardChip` (swatch + network mark +
  "•••• 1234", the localized kind word on wide screens, full accessible name)
  resolved client-side by `useCardMap().forTx(tx)` — `tx.card_id`, else the
  credit card that IS the row's account.
- Pickers (`AccountSelector`, recurring, Pay-card) key selection by
  `card_id ?? account_id`; a credit-card account is rendered AS its card
  (never twice); debit cards are peer tiles that post to their bank.

## 7. Invariants (tests)

`src/lib/cards.test.ts` (palette, names, chip, expiry, `autopayEligible`,
`autopayPlan` — the three-missed-cycles case, `autopayAmount`), the existing
credit-card suites, `api/_lib/tx-sql.test.ts`, `src/lib/notifications.test.ts`.
Route behaviour was verified against the dev server + Neon with a throwaway
script (attribution on create/edit/group/recurring/transfer, freeze rejection,
catch-up autopay paying once and clamping, close-with-debt 409, reopen,
search) and the Playwright suite (`e2e/cards.spec.ts`).

## 8. Deferred

Minimum payments / interest / grace periods; per-card currency; editing a filed
statement; AI quick-add resolving a *debit* card by name (a credit card is
derived from its account automatically); card-level spending limits beyond the
utilisation alert; drag-to-reorder on the Cards tab (order = position, then
creation).
