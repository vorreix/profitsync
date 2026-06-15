import type { ReactNode } from "react"
import { Navigate } from "react-router-dom"
import { Loader as Loader2 } from "lucide-react"
import { useOrg } from "@/lib/org-context"
import { accountTypeAllows } from "@/lib/types"

/**
 * Client-side guard for the Family hub. Only a family workspace can open it; any
 * other account type is bounced to the dashboard. The server enforces the same
 * rule on every /api/family call — this is just UX.
 */
export function FamilyOnlyRoute({ children }: { children: ReactNode }) {
  const { activeOrg, loading } = useOrg()

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!accountTypeAllows(activeOrg?.account_type, "family")) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
