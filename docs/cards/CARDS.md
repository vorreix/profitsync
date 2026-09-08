# Wealth & Cards

> How ProfitSync models a **card** (debit or credit) on top of the wealth
> ledger, why a card never holds money, how autopay records a statement
> payment exactly once, and the invariants every future change must keep.
> Companion to `src/lib/cards.ts` (pure helpers), `api/_lib/cards.ts`
> (attribution + loading), `api/_lib/card-autopay.ts` (the sync engine) and
> `docs/credit-cards/CREDIT_CARDS.md` (the liability model this builds on).

## 1. What a card is

A card is **identity + attribution linked to a bank**. It never holds money:

| Card | `cards.account_id` (the ledger account it posts to) | `cards.funding_account_id` + `cards.funding_card_id` | `cards.issuer_account_id` |
|---|---|---|---|
| **Debit** | the linked **bank** — a purchase is an ordinary outgoing on that bank | — | — |
| **Credit** | its own **liability account** (`wealth_accounts.type='credit_card'`, signed balance, limit, statements — unchanged from CREDIT_CARDS.md) | who pays the statement (default "Pay from", autopay source); optional | the bank that **gave you the card** |

### Who pays a credit card (mig 0066)

`funding_account_id` is always the account the money LEAVES. `funding_card_id`
is the optional **instrument** on that side and, when set, must resolve to that
same account — the rule `attributeCard` already applies to every transaction
leg. One helper, `api/_lib/cards.ts resolveFunding()`, enforces the pair on both
write paths, so the stored two can never disagree.

| Answer | What happens |
|---|---|
| a **bank** or **cash** | the ordinary case: money leaves an account that holds some |
| a **debit card** | the money still leaves that card's BANK; the card is a label, and the ledger reads "D •••• 1234" on the outgoing leg |
| another **credit card** | a **BALANCE TRANSFER**: the payer's liability account is the source, so its debt goes up as this card's goes down. Net worth does not move — nothing was paid off, only moved |

**Autopay requires a bank or cash.** A card paying a card would compound debt on
a schedule, so both write paths refuse the combination and
`api/_lib/card-autopay.ts` defers again before it claims a statement (the
backstop for a row written before the guard). That one rule is also why there is
no funding-graph cycle check: a loop needs two unattended payers, and a card can
never be one. Self-payment is refused by `resolveFunding` and by same-row CHECK
constraints; a frozen or unusable funding card defers rather than paying
unattributed.

### The card grid is a drag surface (like Banks)

The tile carries a grip beside its kebab and, on a credit card that owes money,
a **Pay card** button. Both are `pointer-events-auto` islands over the tile's
stretched Link. The grip only appears with `canWrite` and more than one open
card — with one card there is nothing to reorder and nothing to drop onto.

Near a tile's leading/trailing edge a drop REORDERS (`POST /api/cards/reorder`,
one atomic `UPDATE … FROM (VALUES …)`; the client keeps an id-only mirror so a
refetch that started before the write still paints the user's order). The middle
means "do something with this card", and the rules live in
`src/components/cards/card-drag.ts`:

| Drop | What happens |
|---|---|
| onto a **credit** card | the **Pay sheet** for it, source pre-filled with the dragged card — the only surface that clamps the amount to what is owed and warns when the money comes from another card |
| onto a **debit** card | the **Transfer wizard**, from the dragged card's account to that card's bank |
| two cards on the **same account** | REFUSED — two debit cards on one bank is ordinary, and the transfer would be account-to-itself, which `createTransfer` rejects. The whole tile becomes a reorder target instead of offering a dialog whose confirm can never enable |
| a **frozen** source | REFUSED — the transfer route resolves the source without `allowFrozen`, so it would fail only after the user typed an amount. Frozen stays a legal DESTINATION: paying a frozen card is always allowed |
| an **archived** destination | REFUSED |

Two mechanics worth keeping: the grid measures `[data-card-drag]` inside its own
ref, never `[data-card-tile]` document-wide (closed rows and the bank overlay
stamp that too), and the rendered list is frozen for the length of a drag so a
card arriving cannot move tiles out from under the rect snapshot. Both dialogs
mount CLOSED and open from an effect — a dialog that mounts already-open pushes
its `useBackClose` history entry inside React's development double-invoke, and
the stray popstate slams it shut.

The payer's own cycle reports what left it as `transfers_out` — not spending
(nothing was bought), but the card really does owe for it, and dropping the leg
(the pre-0066 behaviour) made the cycle understate the card.

### The issuer is a bank account, not a string (mig 0065)

A credit card is given to you BY a bank, so wizard step 1 picks a real bank
account for a credit card exactly as it does for a debit one — or creates it
inline through the ordinary accounts API, which means **an issuer counts
against the plan's bank limit** and the picker shows the crown + upgrade prompt
when the limit is reached. The bank picked there becomes `issuer_account_id`,
seeds `funding_account_id`, and its row is the single source of the card's
branding (name, domain, logo, palette) — the client deliberately stops sending
a mirrored copy, because two sources for one fact is how they drift apart.

Before this, the issuer was free text on the liability account's `bank_name`.
That is why a card branded "Intesa Sanpaolo" was invisible on the Intesa bank
page: the page matches rows, and there was no row to match.

`issuer_account_id` is **nullable forever**. Every card created before 0065 has
none (the migration backfills only where the funding bank's name provably
matches the card's own branding — it never invents a link), and every surface
falls back to `account_bank_name`. `ON DELETE SET NULL`: removing the issuing
bank must never remove the card or the debt on it.

A bank page therefore lists cards in three groups, one card in exactly one of
them, most-involved first (`src/components/cards/bank-cards.ts`): **on this
account** (debit), **paid from this account** (credit it settles), **issued by
this bank** (credit it gave you but does not pay). `GET /api/wealth/accounts`
`card_count` counts the same three, or the tile badge would disagree with the
overlay.

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
