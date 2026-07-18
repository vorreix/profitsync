import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { fetchAiQuota } from "@/lib/ai-parse"

/**
 * Availability + remaining monthly AI parses for the active org. Fetched when
 * the Add-Transaction dialog opens; `enabled:false` (no ANTHROPIC_API_KEY on
 * the server) keeps every AI trigger hidden.
 */
export function useAiQuota(open: boolean) {
  const { getToken } = useAuth()
  const [quota, setQuota] = useState<{ enabled: boolean; remaining: number; limit: number } | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const q = await fetchAiQuota(token)
        if (!cancelled) setQuota(q)
      } catch {
        if (!cancelled) setQuota({ enabled: false, remaining: 0, limit: 0 })
      }
    })()
    return () => { cancelled = true }
  }, [open, getToken])

  return { quota, consumeOne: (remaining: number) => setQuota((q) => (q ? { ...q, remaining } : q)) }
}
