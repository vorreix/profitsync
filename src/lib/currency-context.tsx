import { createContext, useContext, type ReactNode } from "react"
import { useOrg } from "@/lib/org-context"

type CurrencyContextType = {
  currency: string
}

const CurrencyContext = createContext<CurrencyContextType>({ currency: "USD" })

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { activeOrg } = useOrg()
  const currency = activeOrg?.currency ?? "USD"

  return (
    <CurrencyContext.Provider value={{ currency }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export const useCurrency = () => useContext(CurrencyContext)
