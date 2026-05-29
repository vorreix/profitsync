import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useAuth, useUser } from "@clerk/clerk-react"
import { apiGet, apiPost, setActiveOrgId } from "@/lib/api"
import { LEGAL_DOC_VERSION, type Organization, type UserProfile } from "@/lib/types"

type OrgContextValue = {
  orgs: Organization[]
  activeOrg: Organization | null
  loading: boolean
  switchOrg: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

const OrgContext = createContext<OrgContextValue>({
  orgs: [],
  activeOrg: null,
  loading: true,
  switchOrg: async () => {},
  refresh: async () => {},
})

export function OrgProvider({ children }: { children: ReactNode }) {
  const { getToken, isSignedIn } = useAuth()
  const { user } = useUser()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!isSignedIn) return
    const token = await getToken()
    if (!token) return

    // Profile and org list are independent (both scoped by user id) — fetch in
    // parallel to halve the app's cold-boot latency.
    const [profile, list] = await Promise.all([
      apiGet<UserProfile>("/api/profile", token),
      apiGet<Organization[]>("/api/organizations", token),
    ])

    // Prefer the profile's current org; otherwise fall back to the first (personal) org.
    const activeId = profile.current_organization_id ?? (list.length > 0 ? list[0].id : null)
    if (activeId) {
      setActiveOrgId(activeId)
      setActiveOrgIdState(activeId)
    }
    setOrgs(list)

    // Record legal acceptance once per user — fire-and-forget, never blocks boot.
    if (!profile.terms_accepted_at) {
      apiPost("/api/legal/accept", token, {
        documents: ["terms_of_service", "privacy_policy"],
        version: LEGAL_DOC_VERSION,
      }).catch(() => {
        // non-fatal — we'll retry next session
      })
    }

    setLoading(false)
  }, [getToken, isSignedIn, user?.id])

  useEffect(() => {
    if (!isSignedIn) {
      setActiveOrgId(null)
      setActiveOrgIdState(null)
      setOrgs([])
      setLoading(false)
      return
    }
    refresh()
  }, [isSignedIn, refresh])

  const switchOrg = useCallback(
    async (id: string) => {
      const token = await getToken()
      if (!token) return
      // Optimistically set so subsequent calls use the new header
      setActiveOrgId(id)
      setActiveOrgIdState(id)
      await apiPost("/api/organizations/switch", token, { organization_id: id })
    },
    [getToken],
  )

  const activeOrg = useMemo(
    () => orgs.find((o) => o.id === activeOrgId) ?? null,
    [orgs, activeOrgId],
  )

  return (
    <OrgContext.Provider value={{ orgs, activeOrg, loading, switchOrg, refresh }}>
      {children}
    </OrgContext.Provider>
  )
}

export const useOrg = () => useContext(OrgContext)
