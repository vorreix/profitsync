import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiGet } from "@/lib/api"
import type { UserProfile } from "@/lib/types"

type CurrencyContextType = {
  currency: string
  setCurrency: (c: string) => void
}

const CurrencyContext = createContext<CurrencyContextType>({ currency: "USD", setCurrency: () => {} })

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { getToken, isSignedIn } = useAuth()
  const [currency, setCurrency] = useState("USD")

  useEffect(() => {
    if (!isSignedIn) return
    async function load() {
      try {
        const token = await getToken()
        if (!token) return
        const profile = await apiGet<UserProfile>("/api/profile", token)
        if (profile.currency) setCurrency(profile.currency)
      } catch {}
    }
    load()
  }, [isSignedIn])

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export const useCurrency = () => useContext(CurrencyContext)
