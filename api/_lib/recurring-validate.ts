import { amountExceedsLimit } from "../../src/lib/money.js"
import { FREQUENCY_UNITS, type FrequencyUnit } from "../../src/lib/recurring.js"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export type RecurringRuleInput = {
  name?: string
  type?: string
  amount?: number | string
  category?: string
  client_id?: string | null
  wealth_account_id?: string | null
  frequency_unit?: string
  frequency_interval?: number
  start_date?: string
  end_date?: string | null
}

export type ValidatedRule = {
  name: string
  type: "incoming" | "outgoing"
  amount: string
  category: string
  clientId: string | null
  wealthAccountId: string | null
  frequencyUnit: FrequencyUnit
  frequencyInterval: number
  startDate: string
  endDate: string | null
}

export function validateRuleInput(body: RecurringRuleInput): { error: string } | { value: ValidatedRule } {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : ""
  if (!name) return { error: "name is required" }
  if (body.type !== "incoming" && body.type !== "outgoing") return { error: "type must be incoming or outgoing" }
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) return { error: "amount must be a positive number" }
  if (amountExceedsLimit(amount)) return { error: "Amount is too large" }
  const frequencyUnit = (body.frequency_unit ?? "month") as FrequencyUnit
  if (!FREQUENCY_UNITS.includes(frequencyUnit)) return { error: "frequency_unit must be day, week, month or year" }
  const frequencyInterval = Math.floor(Number(body.frequency_interval ?? 1))
  if (!Number.isFinite(frequencyInterval) || frequencyInterval < 1 || frequencyInterval > 365) {
    return { error: "frequency_interval must be between 1 and 365" }
  }
  const startDate = body.start_date ?? ""
  if (!ISO_DATE.test(startDate)) return { error: "start_date must be YYYY-MM-DD" }
  const endDate = body.end_date ?? null
  if (endDate !== null && !ISO_DATE.test(endDate)) return { error: "end_date must be YYYY-MM-DD" }
  if (endDate && endDate < startDate) return { error: "end_date must be on or after start_date" }
  return {
    value: {
      name,
      type: body.type,
      amount: amount.toFixed(2),
      category: typeof body.category === "string" ? body.category.trim().slice(0, 60) : "",
      clientId: body.client_id ?? null,
      wealthAccountId: body.wealth_account_id ?? null,
      frequencyUnit,
      frequencyInterval,
      startDate,
      endDate,
    },
  }
}
