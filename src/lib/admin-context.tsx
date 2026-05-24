import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiGet } from "@/lib/api"

type AdminContextValue = {
  isAdmin: boolean
  loading: boolean
}

const AdminContext = createContext<AdminContextValue>({ isAdmin: false, loading: true })

export function AdminProvider({ children }: { children: ReactNode }) {
  const { getToken, isSignedIn } = useAuth()
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isSignedIn) {
      setIsAdmin(false)
      setLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      try {
        const token = await getToken()
        if (!token) return
        await apiGet("/api/admin/me", token)
        if (!cancelled) setIsAdmin(true)
      } catch {
        if (!cancelled) setIsAdmin(false)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [getToken, isSignedIn])

  return <AdminContext.Provider value={{ isAdmin, loading }}>{children}</AdminContext.Provider>
}

export const useAdmin = () => useContext(AdminContext)
