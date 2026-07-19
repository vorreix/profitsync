import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { fetchAiQuota, type AiQuota } from "@/lib/ai-parse"

/**
 * Availability, capabilities (voice, per-plan recording ceiling) and remaining
 * monthly AI parses for the active org. Fetched when the Add-Transaction
 * dialog opens; `enabled:false` (no AI provider key on the server) keeps every
 * AI trigger hidden, `voice:false` hides just the mic.
 */
export function useAiQuota(open: boolean) {
  const { getToken } = useAuth()
  const [quota, setQuota] = useState<AiQuota | null>(null)

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
        if (!cancelled) setQuota({ enabled: false, voice: false, remaining: 0, limit: 0, max_record_seconds: 0, assistant_max_record_seconds: 0, costs: { quickadd: 5, quickaddMedia: 10, assistant: 20 }, plan_key: "free" })
      }
    })()
    return () => { cancelled = true }
  }, [open, getToken])

  return { quota, consumeOne: (remaining: number) => setQuota((q) => (q ? { ...q, remaining } : q)) }
}
