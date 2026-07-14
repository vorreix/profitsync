import { useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { useOrg } from "@/lib/org-context"
import { decideNoOrgSwitch } from "@/lib/notifications"

// Org-switch on notification tap.
//
// A push for a non-active org deep-links with `?no_org=<orgId>` (server side:
// api/_lib/notifications.ts → pushUrlWithOrg). Whatever opened that URL — the web
// service worker (`client.navigate` on an existing tab, or `openWindow` on a cold
// start) or the native tap handler's react-router `navigate` (native-push.ts) —
// this hook switches the active org to the notification's org so its target is
// shown IN the right account, then strips the param.
//
// It is a no-op unless the target differs from the active org AND the user is a
// member of it (guards a stale push after leaving an org). It waits for the org
// list to load before acting so a cold start doesn't drop the switch. Mount once,
// inside OrgProvider (AppLayoutInner), so it runs on both the desktop and mobile
// shells.
export function useNotificationOrgSwitch(): void {
  const [params, setParams] = useSearchParams()
  const { switchOrg, activeOrg, orgs, loading } = useOrg()

  useEffect(() => {
    const { strip, switchTo } = decideNoOrgSwitch(
      params.get("no_org"),
      activeOrg?.id ?? null,
      orgs.map((o) => o.id),
      loading,
    )
    if (!strip) return

    // Strip the param first (replace) so a re-render or back-nav can't re-trigger
    // the switch; only then act on it.
    const next = new URLSearchParams(params)
    next.delete("no_org")
    setParams(next, { replace: true })

    if (switchTo) void switchOrg(switchTo)
  }, [params, loading, activeOrg?.id, orgs, switchOrg, setParams])
}
