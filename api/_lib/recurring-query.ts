// The columns every recurring-rule READ returns — shared by the list
// (api/_routes/recurring.ts) and the single-rule detail
// (api/_routes/recurring/[id].ts) so the two can never drift apart: the detail
// page renders the same header the list row shows, from the same fields.

import { sql } from "drizzle-orm"
import { clients, recurringRules, wealthAccounts } from "../../src/lib/db/schema.js"

/** Live transactions this rule has created (soft-deleted ones don't count). */
const generatedCountSql = sql<number>`(
  select count(*)::int from transactions t
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
  accountIcon: wealthAccounts.icon,
  accountLogoUrl: wealthAccounts.logoUrl,
  cardId: recurringRules.cardId,
  // 'standard' income/expense, or 'transfer' (a Space auto-save — managed on
  // /spaces, so the UI routes those elsewhere instead of half-rendering them).
  kind: recurringRules.kind,
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
