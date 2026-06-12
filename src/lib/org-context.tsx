import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiGet, apiPost, setActiveOrgId } from "@/lib/api"
import { LEGAL_DOC_VERSION, type Organization, type UserProfile } from "@/lib/types"

type OrgContextValue = {
  orgs: Organization[]
  activeOrg: Organization | null
  profile: UserProfile | null
  /** True once the profile has loaded and the user hasn't completed onboarding. */
  needsOnboarding: boolean
  loading: boolean
  switchOrg: (id: string) => Promise<void>
  refresh: () => Promise<void>
  /**
   * Push a freshly-saved profile into the shared context so dependent surfaces
   * (the sidebar/menu avatar, greeting…) update in place — no refetch, no
   * skeleton. Call after a successful /api/profile PATCH.
   */
  updateProfile: (profile: UserProfile) => void
}

const OrgContext = createContext<OrgContextValue>({
  orgs: [],
  activeOrg: null,
  profile: null,
  needsOnboarding: false,
  loading: true,
  switchOrg: async () => {},
  refresh: async () => {},
  updateProfile: () => {},
})

export function OrgProvider({ children }: { children: ReactNode }) {
  const { getToken, isSignedIn } = useAuth()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!isSignedIn) {
      setLoading(false)
      return
    }
    try {
      const token = await getToken()
      if (!token) return

      // Profile and org list are independent (both scoped by user id) — fetch in
      // parallel to halve the app's cold-boot latency.
      const [profileData, list] = await Promise.all([
        apiGet<UserProfile>("/api/profile", token),
        apiGet<Organization[]>("/api/organizations", token),
      ])

      setProfile(profileData)

      // Prefer the profile's current org; otherwise fall back to the first (personal) org.
      const activeId = profileData.current_organization_id ?? (list.length > 0 ? list[0].id : null)
      if (activeId) {
        setActiveOrgId(activeId)
        setActiveOrgIdState(activeId)
      }
      setOrgs(list)

      // Record legal acceptance once per user — fire-and-forget, never blocks boot.
      if (!profileData.terms_accepted_at) {
        apiPost("/api/legal/accept", token, {
          documents: ["terms_of_service", "privacy_policy"],
          version: LEGAL_DOC_VERSION,
        }).catch(() => {
          // non-fatal — we'll retry next session
        })
      }
    } catch {
      // Non-fatal: leave whatever we have; the UI will render with defaults.
    } finally {
      setLoading(false)
    }
    // `user?.id` intentionally omitted: it resolves slightly after mount and would
    // re-run this whole bootstrap a second time. isSignedIn already covers re-auth.
  }, [getToken, isSignedIn])

  useEffect(() => {
    if (!isSignedIn) {
      setActiveOrgId(null)
      setActiveOrgIdState(null)
      setOrgs([])
      setProfile(null)
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

  // Onboarding is complete once `onboarded_at` is set. Only meaningful after the
  // profile has loaded, so a null profile (still loading) never triggers it.
  const needsOnboarding = !!profile && !profile.onboarded_at

  return (
    <OrgContext.Provider value={{ orgs, activeOrg, profile, needsOnboarding, loading, switchOrg, refresh, updateProfile: setProfile }}>
      {children}
    </OrgContext.Provider>
  )
}

export const useOrg = () => useContext(OrgContext)
