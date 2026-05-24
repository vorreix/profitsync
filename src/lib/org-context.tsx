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

    // Load profile first to determine the active org
    const profile = await apiGet<UserProfile>("/api/profile", token)
    if (profile.current_organization_id) {
      setActiveOrgId(profile.current_organization_id)
      setActiveOrgIdState(profile.current_organization_id)
    }

    // Record legal acceptance once per user if not already done.
    if (!profile.terms_accepted_at) {
      try {
        await apiPost("/api/legal/accept", token, {
          documents: ["terms_of_service", "privacy_policy"],
          version: LEGAL_DOC_VERSION,
        })
      } catch {
        // non-fatal — we'll retry next session
      }
    }

    // Then list orgs (now that the header is set, the API returns org-scoped data)
    const list = await apiGet<Organization[]>("/api/organizations", token)
    setOrgs(list)

    // Fallback: if profile had no current org but list is non-empty, pick first (personal)
    if (!profile.current_organization_id && list.length > 0) {
      const first = list[0]
      setActiveOrgId(first.id)
      setActiveOrgIdState(first.id)
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
