import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useOrg } from "@/lib/org-context"

type CurrencyContextType = {
  currency: string
}

const CurrencyContext = createContext<CurrencyContextType>({ currency: "USD" })

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { activeOrg } = useOrg()
  const currency = activeOrg?.currency ?? "USD"

  // Stable value identity: without the memo, every OrgProvider render re-created
  // this object and re-rendered all 20+ useCurrency() consumers even when the
  // currency itself hadn't changed.
  const value = useMemo(() => ({ currency }), [currency])

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  )
}

export const useCurrency = () => useContext(CurrencyContext)
