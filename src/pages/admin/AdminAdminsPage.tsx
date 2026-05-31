import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Loader as Loader2, ShieldCheck, Crown, Trash2, UserPlus } from "lucide-react"

type Admin = {
  user_id: string | null
  email: string | null
  full_name: string | null
  is_root: boolean
  is_self: boolean
  created_at: string | null
}

export function AdminAdminsPage() {
  const { getToken } = useAuth()
  const [admins, setAdmins] = useState<Admin[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState("")
  const [adding, setAdding] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<Admin | null>(null)
  const [removing, setRemoving] = useState(false)

  async function load() {
    try {
      const token = await getToken()
      if (!token) return
      const data = await apiGet<{ admins: Admin[] }>("/api/admin/admins", token)
      setAdmins(data.admins)
    } catch {
      toast.error("Failed to load admins")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken])

  const handleAdd = async () => {
    if (!email.trim()) return
    setAdding(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPost("/api/admin/admins", token, { email: email.trim() })
      toast.success(`${email.trim()} is now an admin`)
      setEmail("")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add admin")
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async () => {
    if (!removeTarget?.user_id) return
    setRemoving(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiDelete("/api/admin/admins", token, { user_id: removeTarget.user_id })
      toast.success(`Removed ${removeTarget.email ?? "admin"}`)
      setRemoveTarget(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove admin")
    } finally {
      setRemoving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admins</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Platform admins can access this console. The <span className="font-medium">root admin(s)</span> are set by the{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">ROOT_ADMIN_EMAILS</code> environment variable and can't
          be removed here — they manage everyone else from this page.
        </p>
      </div>

      {/* Add an admin */}
      <Card className="p-5 space-y-3 border-dashed">
        <div className="flex items-center gap-2">
          <UserPlus className="size-4" />
          <h2 className="font-semibold">Add an admin</h2>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            placeholder="person@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd() }}
            className="sm:max-w-sm"
          />
          <Button onClick={handleAdd} disabled={adding || !email.trim()}>
            {adding ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <UserPlus className="size-3.5 mr-1.5" />}
            Add admin
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">The person must have signed up already.</p>
      </Card>

      {/* Admin list */}
      <Card className="divide-y">
        {admins.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No admins yet.</div>
        ) : (
          admins.map((a, i) => (
            <div key={a.user_id ?? a.email ?? i} className="flex items-center gap-3 p-4">
              <div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${a.is_root ? "bg-amber-500/15 text-amber-600 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>
                {a.is_root ? <Crown className="size-4" /> : <ShieldCheck className="size-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-sm font-medium truncate">{a.full_name || a.email || "Unknown"}</p>
                  {a.is_root && <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-300">Root</Badge>}
                  {a.is_self && <Badge variant="secondary">You</Badge>}
                  {!a.user_id && <Badge variant="outline" className="text-muted-foreground">Not signed in</Badge>}
                </div>
                {a.full_name && a.email && <p className="text-xs text-muted-foreground truncate">{a.email}</p>}
              </div>
              {!a.is_root && !a.is_self && a.user_id && (
                <Button
                  variant="outline"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => setRemoveTarget(a)}
                  title="Remove admin"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))
        )}
      </Card>

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => { if (!o) setRemoveTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove admin access?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget?.email ?? "This user"} will lose access to the admin console. Their account and data are not
              affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleRemove() }}
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Trash2 className="size-3.5 mr-1.5" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
