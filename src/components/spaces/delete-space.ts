import { isLiabilityType } from "@/lib/credit-card"
import type { WealthAccount } from "@/lib/types"
import { accountCurrency } from "@/lib/wealth"

type Dest = Pick<WealthAccount, "id" | "type" | "currency_code" | "is_default">

/**
 * Where a deleted Space's money goes by default: an account in the Space's
 * currency (the default one first), else any — but always money the user
 * HOLDS. A credit card would quietly turn "move & close" into a card payment.
 */
export function defaultSpaceDestination(accounts: Dest[], spaceCurrency: string, fallback: string): string {
  const holding = accounts.filter((a) => !isLiabilityType(a.type))
  const same = holding.filter((a) => accountCurrency(a, fallback) === spaceCurrency)
  return (same.find((a) => a.is_default) ?? same[0] ?? holding.find((a) => a.is_default) ?? holding[0])?.id ?? ""
}

/**
 * The delete needs a "received" figure only when money actually moves across
 * currencies. An EMPTY Space whose currency no account shares used to demand
 * one it never showed, and could never be deleted.
 */
export function needsReceivedAmount(balance: number, spaceCurrency: string, destCurrency: string | null): boolean {
  return balance > 0 && destCurrency !== null && destCurrency !== spaceCurrency
}
