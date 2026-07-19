import { useEffect, useRef, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiGet } from "@/lib/api"

export type SearchClient = { id: string; name: string; company: string; status: string }
export type SearchTransaction = {
  id: string
  description: string
  amount: string
  type: string
  date: string
  category: string
  client_id: string
  client_name: string
}
export type SearchQuotation = { id: string; title: string; prospect_name: string; status: string; amount: string }
export type SearchAccount = { id: string; bank_name: string; nickname: string; type: string; icon: string }
export type SearchCategory = { id: string; name: string; type: string; color: string }

export type SearchResults = {
  clients: SearchClient[]
  transactions: SearchTransaction[]
  quotations: SearchQuotation[]
  accounts: SearchAccount[]
  categories: SearchCategory[]
}

export const SEARCH_MIN_CHARS = 2
const DEBOUNCE_MS = 250

/** Where each server result navigates. Shared by the desktop palette and the mobile overlay. */
export const searchHrefs = {
  client: (c: SearchClient) => `/clients/${c.id}`,
  // ?view= opens the existing detail modal, which fetches the tx itself when
  // it isn't in the visible page — no scroll/highlight machinery needed.
  transaction: (tx: SearchTransaction) => `/transactions?view=${tx.id}`,
  quotation: (qt: SearchQuotation) => `/quotations?view=${qt.id}`,
  account: (a: SearchAccount) => (a.type === "space" ? "/spaces" : `/wealth/${a.id}`),
  category: () => "/categories",
}

/**
 * Debounced org-scoped server search. Results are `null` until the query
 * reaches SEARCH_MIN_CHARS; stale responses are dropped; errors degrade to
 * `null` so the local (pages/actions) groups still render.
 */
export function useGlobalSearch(query: string): { results: SearchResults | null; loading: boolean } {
  const { getToken } = useAuth()
  const [results, setResults] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const requestId = useRef(0)
  const q = query.trim()

  useEffect(() => {
    if (q.length < SEARCH_MIN_CHARS) {
      requestId.current++
      setResults(null)
      setLoading(false)
      return
    }
    const id = ++requestId.current
    setLoading(true)
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const token = await getToken()
          if (!token || requestId.current !== id) return
          const data = await apiGet<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`, token)
          if (requestId.current === id) setResults(data)
        } catch {
          if (requestId.current === id) setResults(null)
        } finally {
          if (requestId.current === id) setLoading(false)
        }
      })()
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [q, getToken])

  return { results, loading }
}
