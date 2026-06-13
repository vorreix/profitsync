import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiGet } from "@/lib/api"
import { type AdminCapability } from "@/lib/admin-roles"

type AdminMe = { userId: string; isAdmin: boolean; role: string; caps: AdminCapability[] }

type AdminContextValue = {
  isAdmin: boolean
  // System role key OR a custom role key — gate UI off `can`/`caps`, never
  // off the role name (custom roles would break).
  role: string | null
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
  const [role, setRole] = useState<string | null>(null)
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

  // Membership in the SERVER-resolved capability set (covers custom roles —
  // the static role→caps map only knows the built-in roles).
  const can = (cap: AdminCapability) => caps.includes(cap)

  return (
    <AdminContext.Provider value={{ isAdmin: role !== null, role, caps, can, loading }}>
      {children}
    </AdminContext.Provider>
  )
}

export const useAdmin = () => useContext(AdminContext)
