# The dashboard attention rail

A swipeable, severity-coloured carousel at the top of `/dashboard` answering one
question: **what needs you right now?** A card payment overdue, a charge tomorrow
the account cannot cover, a card about to expire, a recurring payment that has
quietly stopped, the salary that just landed.

When the answer is "nothing", it renders nothing.

## The one decision everything follows from

**An alert is a STATE, not an EVENT.** Nothing here reads the `notifications`
table, even though almost every item has a matching notification type.

A notification is an immutable log row: *this happened*. A banner built on one
keeps saying "card payment overdue" after the card is paid, until somebody marks
it read. So every item is re-derived from current data on each request and
disappears the moment it stops being true. Even the two that look like events —
"salary came in", "rent posted automatically" — are read back out of the ledger
over a two-day window, so trashing that transaction takes the banner with it.

The bell and the rail therefore disagree by design: the bell is history, the rail
is now.

## Layers

| File | Owns |
|---|---|
| `src/lib/alerts.ts` | **Pure.** Severity, ordering, the forward projection, and the rules that turn rows into items. DB-free, no React, 55 unit tests. |
| `api/_lib/alerts.ts` | **SQL only.** Six concurrent set-based queries. |
| `api/_routes/alerts.ts` | `GET /api/alerts` — auth + compose. |
| `src/components/alerts/AlertsBanner.tsx` | The carousel. |
| `src/components/alerts/alert-dismissals.ts` | Snoozing (pure, tested). |

Same three-layer split as budget-v2, for the same reason: the unit gate is
DB-free, so money math is only testable if it lives in layer one.

## Invariants

1. **READ-ONLY.** Every other route over this data materialises money on the way
   past — `/api/cards` and `/api/wealth/accounts` run `materializeDueRecurring` +
   `syncCards`, and `loadCardSummary` files statements through `ensureStatements`.
   If this one did too, *opening the dashboard* would post transactions and run
   autopay as a side effect of drawing a banner. `scripts/check-cache-map.mjs`
   holds the line: import one of those helpers and the build fails until
   `/api/alerts` joins `ALWAYS_FETCH` — which is the moment to stop, not to edit
   the list.
2. **The baseline is as-of-today, not `current_balance`.** A transaction applies
   its balance delta at create with no date condition, so a row dated three weeks
   out is *already inside* the stored balance. The server subtracts those rows
   back out and replays them as dated events; adding future charges to the raw
   column double-counts them.
3. **A credit card's floor is its limit, not zero.** `availableCredit()` clamps at
   0 so an over-limit card reads "0 available" — right for display, useless for a
   projection, because clamped it can never go negative and an overrun can never
   be detected. `headroom()` is the unclamped form.
4. **A card-funded recurring charge never touches a bank.** The schema guarantees
   such a rule's `wealth_account_id` IS the card's liability account. Projecting
   it against a bank invents a shortfall that cannot happen.
5. **Autopay is only blamed where the engine recorded a failure.** Autopay runs
   only inside `syncCards`, which this route must not call, so an overdue
   statement on an autopay card usually means autopay has not had its *turn* —
   not that it lost it. `autopayOutlook()` claims failure only on a `failed`
   status, a deferral with a recorded reason, or a `processing` claim older than
   `STALE_CLAIM_MS`. It reuses the engine's own `autopayEligible()` so the banner
   cannot promise a payment autopay will never make.
6. **Never demand more than the card owes.** A refund after the close moves the
   balance but is deliberately not counted as a payment, so `remaining` can
   outlive the debt. Every amount goes through `autopayAmount()` — the same clamp
   the engine applies before moving money.
7. **Only the first shortfall per account, but everything on that account is
   suppressed.** The walk stops at the first hit; keying the suppression off that
   single hit would leave a larger later charge showing a calm blue "coming up"
   behind the small one that tripped it.
8. **Dismissal is a snooze, never a delete** (7 days), and what may be dismissed
   is decided by whether there is anything to DO — not by severity. An overdue
   payment, a shortfall, an expired card and a paused rule all have an action
   behind them, so they clear by being *fixed* and nothing else; that is the
   whole point of deriving them fresh. `card_expiring` is the warning-tier
   exception: there is nothing to do about a card expiring next month but wait
   for the replacement, and nagging about it every visit for a month is how
   someone learns to stop reading the rail. Its snooze id carries the expiry, so
   it returns a few times as the date nears and disappears for good once the new
   card's dates are saved.

## Time

UTC ISO date strings throughout, the same convention as `src/lib/recurring.ts`
and `src/lib/credit-card.ts`. There is no timezone on `organizations` or
`user_profiles` (only `budget_plans.timezone` exists, and only for orgs with a
plan), so "today" is `todayIso()` exactly as the recurring materializer sees it.
A second notion of today here would make the rail disagree with the screen it
links to. The cost is real and known: for a user at UTC+13, a day word can be
one day early. Fixing it properly means giving the whole app a timezone, not
giving this feature its own.

## Caching

`/api/alerts` is in the **money** freshness class, in `NO_STALE` (its claim is
that it is true *right now*), in `MONEY_PREFIXES` (every money write drops it),
never persisted, and deliberately **not** in `ALWAYS_FETCH`. See the
`data-fetching-and-cache` skill.

## Copy

Its own `alerts` i18n namespace in all eight locales rather than reusing
`notifications.types.*`. Those strings are notification-shaped, and two of them
cannot be translated correctly in a banner: `card_payment_due_soon.body`
hard-codes `({{days}} day(s))` with no i18next plural form, which Arabic's six
plural categories have no way into, and `card_autopay_failed.body` interpolates a
server-built English `{{reason}}` into an otherwise translated sentence. The rail
carries the day count in one shared set of plural keys (`when.*`) instead, and
never interpolates untranslated server text.

Amounts are formatted in the org's currency and obey the balance-privacy toggle.
