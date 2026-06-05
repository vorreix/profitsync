import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiGet } from "@/lib/api"
import { adminCan as roleCan, type AdminCapability, type AdminRole } from "@/lib/admin-roles"

type AdminMe = { userId: string; isAdmin: boolean; role: AdminRole; caps: AdminCapability[] }

type AdminContextValue = {
  isAdmin: boolean
  role: AdminRole | null
  caps: AdminCapability[]
  can: (cap: AdminCapability) => boolean
  loading: boolean
}

const AdminContext = createContext<AdminContextValue>({
  isAdmin: false,
  role: null,
  caps: [],
  can: () => false,
  loading: true,
})

export function AdminProvider({ children }: { children: ReactNode }) {
  const { getToken, isSignedIn } = useAuth()
  const [role, setRole] = useState<AdminRole | null>(null)
  const [caps, setCaps] = useState<AdminCapability[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isSignedIn) {
      setRole(null)
      setCaps([])
      setLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      try {
        const token = await getToken()
        if (!token) return
        const me = await apiGet<AdminMe>("/api/admin/me", token)
        if (!cancelled) {
          setRole(me.role ?? null)
          setCaps(me.caps ?? [])
        }
      } catch {
        if (!cancelled) {
          setRole(null)
          setCaps([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [getToken, isSignedIn])

  const can = (cap: AdminCapability) => roleCan(role, cap)

  return (
    <AdminContext.Provider value={{ isAdmin: role !== null, role, caps, can, loading }}>
      {children}
    </AdminContext.Provider>
  )
}

export const useAdmin = () => useContext(AdminContext)
