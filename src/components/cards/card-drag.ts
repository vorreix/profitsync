// The pure rules behind dragging one card tile onto another. Kept out of the
// component so every case is unit-tested and the grid only renders what these
// return (the same split card-dates.ts uses, and what React Fast Refresh wants).
import type { Card } from "@/lib/types"

/** Move the item at `from` so it sits at index `before`. */
export function moveBefore<T>(items: T[], from: number, before: number): T[] {
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(before > from ? before - 1 : before, 0, moved)
  return next
}

export type CardDropAction = { kind: "pay" | "transfer" }

/**
 * What releasing `from` on the middle of `to` should do — or null when the
 * middle must offer nothing at all and the whole tile is a reorder target.
 *
 * Every card resolves to a LEDGER ACCOUNT (a debit card to its bank, a credit
 * card to its own liability account), so a card-onto-card drop is really a
 * transfer between those two accounts. That is where the refusals come from:
 *
 *  • SAME ACCOUNT — two debit cards on one bank is ordinary, and the schema
 *    allows it (only `cards_credit_account_unique` is 1:1). There is nothing to
 *    move between them, and offering it would open a dialog whose confirm can
 *    never enable, because createTransfer refuses from === to.
 *  • THE SOURCE IS NOT USABLE — frozen, or on an archived account. The transfer
 *    route resolves the source card without `allowFrozen`, so the gesture would
 *    end in a raw server error after the user had typed an amount. A frozen
 *    card stays a legal DESTINATION: paying it is always allowed.
 *  • THE DESTINATION IS ARCHIVED — createTransfer only accepts active accounts.
 *
 * Otherwise the TARGET picks the dialog. Dropping onto a credit card means
 * paying it, and only the Pay sheet clamps the amount to what is actually owed
 * and warns when the money is coming from another card rather than from money
 * the user holds.
 */
export function cardDropAction(from: Card, to: Card, usableIds: ReadonlySet<string>): CardDropAction | null {
  if (from.id === to.id) return null
  if (from.account_id === to.account_id) return null
  if (!usableIds.has(from.id)) return null
  if (to.account_archived_at) return null
  return { kind: to.kind === "credit" ? "pay" : "transfer" }
}
