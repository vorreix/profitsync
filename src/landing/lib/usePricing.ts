import { useCallback, useEffect, useState } from "react"

// Shape returned by the public pricing endpoint (api/_routes/public/pricing.ts),
// which reuses the same `plans` table + geo/discount logic as the in-app
// /api/billing/pricing route — just without auth or the per-org subscription.
export type LocalPricing = {
  currency: string
  monthly: number
  yearly: number
  monthly_discount_pct: number
  yearly_discount_pct: number
}

export type PublicPlan = {
  id: string
  key: string
  name: string
  description?: string
  monthly_price_usd: string
  yearly_price_usd: string
  monthly_discount_pct: number
  yearly_discount_pct: number
  promo_note: string
  limits: Record<string, number>
  feature_labels: Record<string, string>
  country: string
  local_pricing: LocalPricing
}

export type PublicPricing = {
  plans: PublicPlan[]
  detectedCountry: string
}

type State = {
  data: PublicPricing | null
  loading: boolean
  error: boolean
}

export function usePricing() {
  const [state, setState] = useState<State>({ data: null, loading: true, error: false })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }))
    try {
      const res = await fetch("/api/public/pricing", { headers: { Accept: "application/json" } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as PublicPricing
      setState({ data: json, loading: false, error: false })
    } catch {
      setState({ data: null, loading: false, error: true })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { ...state, reload: load }
}
