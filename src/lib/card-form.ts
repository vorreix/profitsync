// Shape + helpers for the credit-card account form, shared by the create and
// edit dialogs (plain module, like bank-form.ts). Validation reuses the same
// pure rules the server enforces (src/lib/credit-card.ts) so the inline error
// and the 400 can never disagree.

import { validateCardOnboarding, type CardOnboardingError } from "@/lib/credit-card"

export type CardFormState = {
  bank_name: string
  nickname: string
  icon: string
  brand_domain: string
  logo_url: string
  credit_limit: string
  current_debt: string
  statement_closing_day: string
  payment_due_day: string
  // "I know my latest statement" (create only)
  know_statement: boolean
  statement_balance: string
  statement_closing_date: string
  statement_due_date: string
}

export const emptyCardForm: CardFormState = {
  bank_name: "", nickname: "", icon: "card", brand_domain: "", logo_url: "",
  credit_limit: "", current_debt: "", statement_closing_day: "", payment_due_day: "",
  know_statement: false, statement_balance: "", statement_closing_date: "", statement_due_date: "",
}

/** Seed the edit form from a saved card. */
export function cardFormFromAccount(a: {
  bank_name: string; nickname: string; icon: string
  brand_domain?: string; logo_url?: string
  credit_limit?: number | string | null; statement_closing_day?: number | null; payment_due_day?: number | null
}): CardFormState {
  return {
    ...emptyCardForm,
    bank_name: a.bank_name, nickname: a.nickname, icon: a.icon || "card",
    brand_domain: a.brand_domain ?? "", logo_url: a.logo_url ?? "",
    credit_limit: a.credit_limit == null ? "" : String(a.credit_limit),
    statement_closing_day: a.statement_closing_day == null ? "" : String(a.statement_closing_day),
    payment_due_day: a.payment_due_day == null ? "" : String(a.payment_due_day),
  }
}

const int = (v: string): number => (v.trim() === "" ? NaN : Number(v))

/**
 * Validate a create form. Returns the first problem as the same code the
 * server uses, or "name_required", or null when valid.
 */
export function validateCardForm(f: CardFormState, today: string): CardOnboardingError | "name_required" | null {
  if (!f.bank_name.trim()) return "name_required"
  return validateCardOnboarding(
    {
      creditLimit: Number(f.credit_limit),
      currentDebt: f.current_debt.trim() === "" ? 0 : Number(f.current_debt),
      statementClosingDay: int(f.statement_closing_day),
      paymentDueDay: int(f.payment_due_day),
      statement: f.know_statement
        ? { balance: f.statement_balance.trim() === "" ? 0 : Number(f.statement_balance), closingDate: f.statement_closing_date }
        : null,
    },
    today,
  )
}

/** Which form field a validation code points at (drives the inline red error). */
export function cardFormErrorField(code: CardOnboardingError | "name_required"): keyof CardFormState {
  switch (code) {
    case "name_required": return "bank_name"
    case "limit_invalid": return "credit_limit"
    case "debt_invalid": return "current_debt"
    case "closing_day_invalid": return "statement_closing_day"
    case "due_day_invalid":
    case "same_day": return "payment_due_day"
    case "statement_balance_invalid": return "statement_balance"
    case "statement_date_invalid":
    case "statement_in_future": return "statement_closing_date"
  }
}

/** The POST /api/wealth/accounts body for a new card. */
export function cardCreatePayload(f: CardFormState) {
  return {
    type: "credit_card" as const,
    bank_name: f.bank_name.trim(),
    nickname: f.nickname.trim(),
    icon: f.icon || "card",
    brand_domain: f.brand_domain,
    logo_url: f.logo_url,
    credit_limit: Number(f.credit_limit),
    current_debt: f.current_debt.trim() === "" ? 0 : Number(f.current_debt),
    statement_closing_day: int(f.statement_closing_day),
    payment_due_day: int(f.payment_due_day),
    statement: f.know_statement
      ? {
          balance: f.statement_balance.trim() === "" ? 0 : Number(f.statement_balance),
          closing_date: f.statement_closing_date,
          ...(f.statement_due_date ? { due_date: f.statement_due_date } : {}),
        }
      : null,
  }
}

/** The PATCH body when editing a card's configuration (debt is adjusted separately). */
export function cardEditPayload(f: CardFormState) {
  return {
    bankName: f.bank_name.trim(),
    nickname: f.nickname.trim(),
    icon: f.icon || "card",
    brand_domain: f.brand_domain,
    logo_url: f.logo_url,
    credit_limit: Number(f.credit_limit),
    statement_closing_day: int(f.statement_closing_day),
    payment_due_day: int(f.payment_due_day),
  }
}
