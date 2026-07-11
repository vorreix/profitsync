import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiGet } from "@/lib/api"
import type { TagUsage } from "@/lib/types"

/**
 * Loads the org's tags from GET /api/tags — a MERGED list of registry rows and
 * tags actually present on entities, each with per-entity usage counts. Inline
 * tags (present on entities but with no registry row) come back with `id: null`;
 * the Tags manager materializes a registry row before it can edit/delete one.
 * The server sorts by total desc then name; we keep whatever order the API gives
 * and re-sort in the UI. `mutateLocal` supports optimistic in-place updates so
 * the list never refetches/flashes; callers reconcile with `refresh()`.
 */
export function useTags() {
  const { getToken } = useAuth()
  const [tags, setTags] = useState<TagUsage[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) return
      const rows = await apiGet<TagUsage[]>("/api/tags", token)
      setTags(Array.isArray(rows) ? rows : [])
    } catch {
      /* keep whatever we had */
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => { refresh() }, [refresh])

  const mutateLocal = useCallback((updater: (prev: TagUsage[]) => TagUsage[]) => {
    setTags(updater)
  }, [])

  return { tags, loading, refresh, mutateLocal }
}
