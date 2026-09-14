// The columns every recurring-rule READ returns — shared by the list
// (api/_routes/recurring.ts) and the single-rule detail
// (api/_routes/recurring/[id].ts) so the two can never drift apart: the detail
// page renders the same header the list row shows, from the same fields.

import { sql } from "drizzle-orm"
import { clients, recurringRules, wealthAccounts } from "../../src/lib/db/schema.js"

/**
 * Live OCCURRENCES this rule has created (soft-deleted ones don't count).
 *
 * Counting `recurring_due_date` rather than rows is what keeps this a count of
 * payments: a debt repayment posts its interest as a second leg carrying the
 * rule id but no due date, so `count(*)` would report one €250 instalment as
 * two. Every leg that IS an occurrence carries the date.
 */
const generatedCountSql = sql<number>`(
  select count(t.recurring_due_date)::int from transactions t
  where t.recurring_rule_id = ${recurringRules.id} and t.deleted_at is null
)`

export const ruleFields = {
  id: recurringRules.id,
  organizationId: recurringRules.organizationId,
  clientId: recurringRules.clientId,
  clientName: clients.name,
  clientIsOwn: clients.isOwn,
  wealthAccountId: recurringRules.wealthAccountId,
  accountName: sql<string | null>`coalesce(nullif(${wealthAccounts.nickname}, ''), ${wealthAccounts.bankName})`,
  // Enough to draw the account exactly as the wealth screens do (glyph + brand
  // logo), so a rule's row and page never fall back to a generic bank icon.
  accountType: wealthAccounts.type,
  // The link pickers run the SAME eligibility predicate as the server
  // (src/lib/debt-recurring.ts). Without this they had to assume the payer was
  // live, and offered rules whose account had been archived — which the server
  // then refused on click.
  accountArchived: sql<boolean>`${wealthAccounts.archivedAt} is not null`,
  accountIcon: wealthAccounts.icon,
  accountLogoUrl: wealthAccounts.logoUrl,
  cardId: recurringRules.cardId,
  // 'standard' income/expense, 'transfer' (a Space auto-save — managed on
  // /spaces, so the UI routes those elsewhere instead of half-rendering them),
  // or 'debt' (a repayment: principal is a transfer, interest and fees are
  // expenses — api/_lib/recurring-debt.ts).
  kind: recurringRules.kind,
  debtAccountId: recurringRules.debtAccountId,
  // Named here rather than joined, so the rule list stays one query: the debt
  // account is a wealth_accounts row like any other and carries its own name.
  debtName: sql<string | null>`(
    select coalesce(nullif(w.nickname, ''), w.bank_name) from wealth_accounts w
    where w.id = ${recurringRules.debtAccountId}
  )`,
  toAccountId: recurringRules.toAccountId,
  name: recurringRules.name,
  type: recurringRules.type,
  amount: recurringRules.amount,
  category: recurringRules.category,
  frequencyUnit: recurringRules.frequencyUnit,
  frequencyInterval: recurringRules.frequencyInterval,
  startDate: recurringRules.startDate,
  endDate: recurringRules.endDate,
  nextDueAt: recurringRules.nextDueAt,
  active: recurringRules.active,
  lastError: recurringRules.lastError,
  createdAt: recurringRules.createdAt,
  generatedCount: generatedCountSql,
}

/**
 * Detail-only extras: what the rule has ACTUALLY posted, summed from the ledger
 * (never stored) so a manually deleted occurrence stops counting immediately.
 * `::text` keeps numeric precision across the wire, like every other money field.
 */
export const ruleStatsFields = {
  postedTotal: sql<string>`(
    select coalesce(sum(t.amount), 0)::text from transactions t
    where t.recurring_rule_id = ${recurringRules.id} and t.deleted_at is null
  )`,
  firstPostedDate: sql<string | null>`(
    select min(t.date)::text from transactions t
    where t.recurring_rule_id = ${recurringRules.id} and t.deleted_at is null
  )`,
  lastPostedDate: sql<string | null>`(
    select max(t.date)::text from transactions t
    where t.recurring_rule_id = ${recurringRules.id} and t.deleted_at is null
  )`,
}
