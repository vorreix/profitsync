// Tiny pure helpers the card surfaces share (kept out of the component files
// so React Fast Refresh keeps working — a file that exports both components and
// plain functions can't hot-swap cleanly).
import { cardExpiresSoon, expiryEndIso, expiryLabel, isCardExpired } from "@/lib/cards"
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

export type ExpiryTier = "expired" | "soon"
export type ExpiryAlertInfo = {
  tier: ExpiryTier
  /** Days until the card stops working (negative once it has). */
  days: number
  /** "MM/YY", already safe to render inside dir="ltr". */
  expiry: string
}

/**
 * The expiry alert a card deserves RIGHT NOW, or null when it deserves none.
 *
 * Only two tiers exist on purpose. The tile's alert rail is worth having only
 * while an empty rail reliably means "nothing needs you" — a neutral chip on
 * every card that is 45 days out, or on every card whose expiry was never
 * typed, would put a pill back on healthy tiles and spend the signal. A closed
 * card is not chased about its expiry either; it is already over.
 */
export function expiryAlert(
  card: Pick<Card, "status" | "expiry_month" | "expiry_year">,
  today = todayIso(),
): ExpiryAlertInfo | null {
  const { expiry_month: m, expiry_year: y } = card
  if (!m || !y || card.status === "closed") return null
  const days = Math.round((Date.parse(`${expiryEndIso(m, y)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  const expiry = expiryLabel(m, y)
  if (isCardExpired(m, y, today)) return { tier: "expired", days, expiry }
  if (cardExpiresSoon(m, y, today, 30)) return { tier: "soon", days, expiry }
  return null
}
