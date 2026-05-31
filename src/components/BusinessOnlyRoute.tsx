import type { ReactNode } from "react"
import { Navigate } from "react-router-dom"
import { Loader as Loader2 } from "lucide-react"
import { useOrg } from "@/lib/org-context"
import { accountTypeAllows, type BusinessFeature } from "@/lib/types"

/**
 * Client-side guard for business-only sections. Personal accounts that navigate
 * directly to a gated route (e.g. /clients) are bounced to the dashboard. The
 * server enforces the same rule on every API call — this is just UX.
 */
export function BusinessOnlyRoute({ feature, children }: { feature: BusinessFeature; children: ReactNode }) {
  const { activeOrg, loading } = useOrg()

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!accountTypeAllows(activeOrg?.account_type, feature)) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
