import { sql } from "drizzle-orm"
import { accountCurrencyLockReason, type AccountCurrencyFacts } from "../../src/lib/account-currency-lock.js"

// The reference facts src/lib/account-currency-lock.ts decides from, as columns
// any select over wealth_accounts can carry. The list GET, the single GET and
// the PATCH all spread THIS object, so the flag that enables the picker and the
// lock that refuses the save are computed from the same SQL (MC-062).
//   • rows: live AND trashed — a restore brings a trashed row back.
//   • recurring: any side (pays from, saves into, repays), active or paused —
//     everything but a rule that has run past its end date.
//   • cards: a card spending from it, or a credit card paid from it — unless
//     closed: a closed card posts nothing, a deleted card with history stays
//     behind closed (cards/[id].ts DELETE), and a reopened card's autopay
//     refuses a funder in another currency (card-autopay.ts).
//   • transfers: planned/pending ones carry amounts stamped in its currency.
// Every subquery but the indexed transactions one also matches the outer
// row's organization: recurring_rules / cards / transfers have no index on
// these account columns, and this rides the ALWAYS_FETCH accounts list, so
// the org predicate keeps each on its org-leading index instead of a scan of
// every tenant's rows per account (same as cardCurrencyLockedSql).
// The outer row is spelled `wealth_accounts.id` on purpose: drizzle renders
// `${wealthAccounts.id}` UNQUALIFIED ("id") in a single-table select, which
// inside these subqueries binds to the subquery's own id and answers false.
export const currencyLockRefs = {
  hasRows: sql<boolean>`exists (select 1 from transactions t where t.wealth_account_id = wealth_accounts.id)`,
  hasRecurring: sql<boolean>`exists (
    select 1 from recurring_rules r
    where r.organization_id = wealth_accounts.organization_id
      and wealth_accounts.id in (r.wealth_account_id, r.to_account_id, r.debt_account_id)
      and (r.end_date is null or r.next_due_at <= r.end_date)
  )`,
  hasCards: sql<boolean>`exists (
    select 1 from cards c
    where c.organization_id = wealth_accounts.organization_id and c.status <> 'closed'
      and wealth_accounts.id in (c.account_id, c.funding_account_id)
  )`,
  hasOpenTransfers: sql<boolean>`exists (
    select 1 from transfers tr
    where tr.organization_id = wealth_accounts.organization_id
      and tr.status in ('planned', 'pending') and tr.deleted_at is null
      and wealth_accounts.id in (tr.source_account_id, tr.destination_account_id)
  )`,
}

/** Swap the raw facts for the `currency_locked` flag + its reason the client reads. */
export function withCurrencyLock<T extends AccountCurrencyFacts>(row: T) {
  const { hasRows: _r, hasRecurring: _rr, hasCards: _c, hasOpenTransfers: _t, ...rest } = row
  const reason = accountCurrencyLockReason(row)
  return { ...rest, currencyLocked: reason !== null, currencyLockReason: reason }
}
