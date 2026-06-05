import { type ReactNode } from "react"
import { Navigate } from "react-router-dom"
import { Loader as Loader2 } from "lucide-react"
import { useAdmin } from "@/lib/admin-context"
import type { AdminCapability } from "@/lib/admin-roles"
import { firstAllowedAdminPath } from "./admin-nav"

/**
 * Gate an admin route by capability. An admin whose role lacks `cap` is
 * redirected to the first admin section their role CAN reach (e.g. a blog_writer
 * landing on /admin is bounced to /admin/blog). Rendered inside AdminLayout, so
 * the AdminProvider context is available.
 */
export function RequireAdminCap({ cap, children }: { cap: AdminCapability; children: ReactNode }) {
  const { can, loading } = useAdmin()

  if (loading) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!can(cap)) {
    return <Navigate to={firstAllowedAdminPath(can)} replace />
  }

  return <>{children}</>
}
