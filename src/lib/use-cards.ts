import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiGet } from "@/lib/api"
import { WEALTH_CHANGED_EVENT } from "@/lib/data-events"
import type { Card } from "@/lib/types"

/**
 * The org's cards (open ones by default), refreshed whenever any wealth-affecting
 * mutation happens (transactions, transfers, accounts, cards — see
 * src/lib/data-events.ts). apiGet's 30 s cache + in-flight dedupe means a page
 * with several chips/pickers still costs one request.
 */
export function useCards(opts: { includeClosed?: boolean; enabled?: boolean } = {}) {
  const { includeClosed = false, enabled = true } = opts
  const { getToken } = useAuth()
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!enabled) return
    const token = await getToken()
    if (!token) return
    if (!silent) setLoading(true)
    try {
      const rows = await apiGet<Card[]>(`/api/cards${includeClosed ? "?includeClosed=1" : ""}`, token)
      setCards(rows)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cards")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [enabled, getToken, includeClosed])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!enabled) return
    const onChanged = () => void load({ silent: true })
    window.addEventListener(WEALTH_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(WEALTH_CHANGED_EVENT, onChanged)
  }, [enabled, load])

  return { cards, loading, error, refresh: load }
}

export type CardMap = {
  byId: Map<string, Card>
  /** A credit card by its liability account id (1:1) — resolves rows that predate card ids. */
  byAccountId: Map<string, Card>
  /** The card a transaction row was paid with, if any. */
  forTx: (tx: { card_id?: string | null; wealth_account_id?: string | null }) => Card | undefined
}

/**
 * Chip resolution for lists: `tx.card_id`, else the credit card that IS the
 * row's account. Includes closed cards so old rows keep their chip.
 */
export function useCardMap(opts: { enabled?: boolean } = {}): CardMap & { loading: boolean; cards: Card[] } {
  const { cards, loading } = useCards({ includeClosed: true, enabled: opts.enabled })
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])
  const byAccountId = useMemo(() => new Map(cards.filter((c) => c.kind === "credit").map((c) => [c.account_id, c])), [cards])
  const forTx = useCallback(
    (tx: { card_id?: string | null; wealth_account_id?: string | null }) =>
      (tx.card_id ? byId.get(tx.card_id) : undefined) ?? (tx.wealth_account_id ? byAccountId.get(tx.wealth_account_id) : undefined),
    [byId, byAccountId],
  )
  return { byId, byAccountId, forTx, loading, cards }
}

/** Cards a user may PAY WITH right now: open, not frozen, on a live account. */
export function usableCards(cards: Card[]): Card[] {
  return cards.filter((c) => c.status === "active" && !c.account_archived_at)
}
