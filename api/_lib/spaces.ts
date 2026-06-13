import { wealthAccounts } from "../../src/lib/db/schema.js"
import { amountExceedsLimit } from "../../src/lib/money.js"

// Shared building blocks for the /api/spaces routes. A Space is a wealth_accounts
// row with type='space'; these are the columns the Space endpoints return (the
// bank-detail/logo columns are irrelevant for savings buckets) plus the input
// validators for the optional goal.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const spaceFields = {
  id: wealthAccounts.id,
  organizationId: wealthAccounts.organizationId,
  type: wealthAccounts.type,
  nickname: wealthAccounts.nickname,
  bankName: wealthAccounts.bankName,
  openingBalance: wealthAccounts.openingBalance,
  currentBalance: wealthAccounts.currentBalance,
  icon: wealthAccounts.icon,
  goalAmount: wealthAccounts.goalAmount,
  targetDate: wealthAccounts.targetDate,
  note: wealthAccounts.note,
  position: wealthAccounts.position,
  archivedAt: wealthAccounts.archivedAt,
  createdAt: wealthAccounts.createdAt,
  updatedAt: wealthAccounts.updatedAt,
}

/** "" / null / 0 → null (no goal). A positive in-range number → stored string. Else "invalid". */
export function parseGoal(value: number | string | null | undefined): string | null | "invalid" {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return "invalid"
  if (amountExceedsLimit(n)) return "invalid"
  return n > 0 ? String(n) : null
}

/** "" / null → null (no target). A 'YYYY-MM-DD' string → itself. Else "invalid". */
export function parseTargetDate(value: string | null | undefined): string | null | "invalid" {
  if (value === null || value === undefined || value === "") return null
  if (!ISO_DATE.test(value)) return "invalid"
  return value
}
