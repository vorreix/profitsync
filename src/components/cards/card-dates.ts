// Tiny pure helpers the card surfaces share (kept out of the component files
// so React Fast Refresh keeps working — a file that exports both components and
// plain functions can't hot-swap cleanly).
import { isCardExpired } from "@/lib/cards"
import type { Card } from "@/lib/types"

export const todayIso = () => new Date().toISOString().slice(0, 10)

/** "Sep 15" from an ISO date (local, so the day never shifts). */
export const shortDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })

export type CardStatusKey = "statusClosed" | "statusFrozen" | "statusExpired" | "statusActive"

/** The one word that describes a card right now (closed beats frozen beats expired). */
export function cardStatusKey(card: Pick<Card, "status" | "expiry_month" | "expiry_year">, today = todayIso()): CardStatusKey {
  if (card.status === "closed") return "statusClosed"
  if (card.status === "frozen") return "statusFrozen"
  if (isCardExpired(card.expiry_month, card.expiry_year, today)) return "statusExpired"
  return "statusActive"
}
