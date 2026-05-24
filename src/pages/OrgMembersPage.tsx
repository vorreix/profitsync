import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiGet, apiPatch, apiPost } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ArrowLeft, Crown, Loader as Loader2, Mail, Plus, ShieldUser, Trash2, User } from "lucide-react"

type MembersResponse = {
  members: Array<{
    id: string
    user_id: string
    role: string
    created_at: string
    email: string | null
    full_name: string | null
  }>
  invitations: Array<{
    id: string
    email: string
    role: string
    token: string
    created_at: string
    expires_at: string | null
  }>
  current_role: string
}

const ROLE_OPTIONS = ["admin", "editor", "viewer"]

function roleBadge(role: string) {
  const map: Record<string, string> = {
    owner: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    admin: "bg-violet-500/15 text-violet-600 border-violet-500/30",
    editor: "bg-sky-500/15 text-sky-600 border-sky-500/30",
    viewer: "bg-slate-500/15 text-slate-600 border-slate-500/30",
  }
  return map[role] ?? "bg-muted text-muted-foreground"
}

export function OrgMembersPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { getToken } = useAuth()
  const { orgs } = useOrg()
  const [data, setData] = useState<MembersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState("editor")
  const [inviting, setInviting] = useState(false)
  const [lastLink, setLastLink] = useState<string | null>(null)

  const org = orgs.find((o) => o.id === id)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<MembersResponse>(`/api/organizations/${id}/members`, token)
      setData(res)
    } catch {
      toast.error("Failed to load members")
    } finally {
      setLoading(false)
    }
  }, [getToken, id])

  useEffect(() => { load() }, [load])

  const handleInvite = async () => {
    if (!id || !inviteEmail.trim()) return
    setInviting(true)
    try {
      const token = await getToken()
      if (!token) return
      const created = await apiPost<{ token: string; email: string }>(`/api/organizations/${id}/members`, token, {
        email: inviteEmail.trim(),
        role: inviteRole,
      })
      const link = `${window.location.origin}/invitations/${created.token}`
      setLastLink(link)
      toast.success(`Invited ${created.email}`)
      setInviteEmail("")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to invite")
    } finally {
      setInviting(false)
    }
  }

  const handleRoleChange = async (memberId: string, role: string) => {
    if (!id) return
    setBusy(memberId + role)
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch(`/api/organizations/${id}/members`, token, { member_id: memberId, role })
      toast.success("Role updated")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setBusy(null)
    }
  }

  const handleRemoveMember = async (memberId: string) => {
    if (!id || !window.confirm("Remove this member?")) return
    setBusy(memberId)
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch(`/api/organizations/${id}/members`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId }),
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success("Member removed")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setBusy(null)
    }
  }

  const handleRevokeInvite = async (invitationId: string) => {
    if (!id) return
    setBusy(invitationId)
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch(`/api/organizations/${id}/members`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ invitation_id: invitationId }),
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success("Invitation revoked")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setBusy(null)
    }
  }

  if (!id) return null
  const canManage = data?.current_role === "owner" || data?.current_role === "admin"
  const canChangeRoles = data?.current_role === "owner"

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <Button variant="ghost" size="sm" onClick={() => navigate("/organizations")} className="-ml-2">
        <ArrowLeft className="size-3.5 mr-1.5" /> Back to organizations
      </Button>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{org?.name ?? "Organization"} members</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Invite teammates and manage their roles. {data?.current_role && (
              <span>You are an <span className="capitalize font-medium">{data.current_role}</span>.</span>
            )}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setInviteOpen(true)}>
            <Plus className="size-4 mr-1.5" /> Invite member
          </Button>
        )}
      </div>

      {loading || !data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <Card>
            <CardContent className="py-3">
              <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Members ({data.members.length})</h2>
              <div className="divide-y">
                {data.members.map((m) => (
                  <div key={m.id} className="py-3 flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <User className="size-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{m.full_name || m.email || m.user_id}</p>
                      {m.email && <p className="text-xs text-muted-foreground truncate">{m.email}</p>}
                    </div>
                    <Badge variant="outline" className={`text-[10px] uppercase tracking-wide ${roleBadge(m.role)}`}>
                      {m.role === "owner" && <Crown className="size-2.5 mr-1" />}
                      {m.role}
                    </Badge>
                    {canChangeRoles && m.role !== "owner" && (
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.id, e.target.value)}
                        disabled={busy?.startsWith(m.id)}
                        className="text-xs bg-background border rounded-md h-7 px-2"
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    )}
                    {(canManage || m.role !== "owner") && data.members.length > 1 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleRemoveMember(m.id)}
                        disabled={busy === m.id || m.role === "owner"}
                        aria-label="Remove"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {data.invitations.length > 0 && (
            <Card>
              <CardContent className="py-3">
                <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Pending invitations ({data.invitations.length})</h2>
                <div className="divide-y">
                  {data.invitations.map((inv) => (
                    <div key={inv.id} className="py-3 flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Mail className="size-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{inv.email}</p>
                        <p className="text-xs text-muted-foreground">
                          Role: <span className="capitalize">{inv.role}</span> ·
                          {inv.expires_at ? ` expires ${inv.expires_at.split("T")[0]}` : " no expiry"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const link = `${window.location.origin}/invitations/${inv.token}`
                          navigator.clipboard.writeText(link)
                          toast.success("Invitation link copied")
                        }}
                      >
                        Copy link
                      </Button>
                      {canManage && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleRevokeInvite(inv.id)}
                          disabled={busy === inv.id}
                          aria-label="Revoke"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={inviteOpen} onOpenChange={(o) => { if (!o) { setInviteOpen(false); setLastLink(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a member</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email address</Label>
              <Input id="invite-email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@example.com" disabled={inviting} />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <div className="flex gap-1.5">
                {ROLE_OPTIONS.map((r) => (
                  <Button key={r} type="button" size="sm" variant={inviteRole === r ? "default" : "outline"} onClick={() => setInviteRole(r)}>
                    {r === "admin" && <ShieldUser className="size-3.5 mr-1" />}
                    <span className="capitalize">{r}</span>
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Editors can create and edit; viewers see read-only data; admins can manage members.
              </p>
            </div>
            {lastLink && (
              <div className="text-xs bg-muted rounded-md p-2 break-all">
                <p className="text-muted-foreground mb-1">Invitation link (share with the invitee):</p>
                <code>{lastLink}</code>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInviteOpen(false)} disabled={inviting}>Close</Button>
            <Button onClick={handleInvite} disabled={!inviteEmail.trim() || inviting}>
              {inviting ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Plus className="size-3.5 mr-1" />}
              Send invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
