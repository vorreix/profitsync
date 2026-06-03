import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiGet } from "@/lib/api"
import type { Category } from "@/lib/types"

/**
 * Loads the org's managed categories from the API (the server seeds sensible
 * defaults on first access). Exposes the raw list plus the names grouped by type
 * for the transaction pickers, and a refresh to re-pull after a mutation.
 */
export function useCategories() {
  const { getToken } = useAuth()
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) return
      const rows = await apiGet<Category[]>("/api/categories", token)
      setCategories(Array.isArray(rows) ? rows : [])
    } catch {
      /* leave whatever we had; the picker still works with free text */
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => { refresh() }, [refresh])

  const byType = useMemo(
    () => ({
      incoming: categories.filter((c) => c.type === "incoming").map((c) => c.name),
      outgoing: categories.filter((c) => c.type === "outgoing").map((c) => c.name),
    }),
    [categories],
  )

  return { categories, byType, loading, refresh }
}
