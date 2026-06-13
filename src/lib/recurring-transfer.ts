// Pure construction of the two transaction legs (+ balance deltas) for ONE
// occurrence of a recurring auto-save (a kind='transfer' rule that moves money
// from a source account into a Space). No I/O — the materializer inserts the
// returned objects and applies the deltas. Kept pure so the money shape is
// unit-tested.
//
// Idempotency invariant: ONLY the outgoing (source) leg carries the recurring
// keys (recurringRuleId + recurringDueDate). The incoming (Space) leg shares the
// group_id but has NO recurring keys — so the unique index on
// (recurring_rule_id, recurring_due_date) can never double-conflict, and the
// materializer creates the incoming leg + both balance updates ONLY when the
// outgoing-leg insert actually returns a row.

import { balanceDelta } from "./wealth-ledger.js"

export type RecurringTransferRule = {
  id: string
  wealthAccountId: string // source account (required for a transfer)
  toAccountId: string // destination Space (required for a transfer)
  amount: number | string
  name: string
  createdBy: string | null
}

export type TransferLegValues = {
  clientId: string
  wealthAccountId: string
  groupId: string
  kind: "transfer"
  type: "incoming" | "outgoing"
  amount: string
  description: string
  category: string
  date: string
  recurringRuleId?: string
  recurringDueDate?: string
  createdBy: string | null
  updatedBy: string | null
}

export type RecurringTransferLegs = {
  outLeg: TransferLegValues // idempotency anchor (carries the recurring keys)
  inLeg: TransferLegValues // shares group_id, NO recurring keys
  sourceDelta: number // add to the source account's current_balance
  destDelta: number // add to the Space's current_balance
}

export function buildRecurringTransferLegs(
  rule: RecurringTransferRule,
  clientId: string,
  dueDate: string,
  groupId: string,
): RecurringTransferLegs {
  const amount = Number(rule.amount)
  const amountStr = amount.toFixed(2)
  const base = {
    clientId,
    groupId,
    kind: "transfer" as const,
    amount: amountStr,
    description: rule.name,
    category: "Transfer",
    date: dueDate,
    createdBy: rule.createdBy,
    updatedBy: rule.createdBy,
  }
  return {
    outLeg: {
      ...base,
      wealthAccountId: rule.wealthAccountId,
      type: "outgoing",
      recurringRuleId: rule.id,
      recurringDueDate: dueDate,
    },
    inLeg: {
      ...base,
      wealthAccountId: rule.toAccountId,
      type: "incoming",
    },
    sourceDelta: balanceDelta("outgoing", amount), // −amount
    destDelta: balanceDelta("incoming", amount), // +amount
  }
}
