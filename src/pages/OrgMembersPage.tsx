import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useNavigate, useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
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
  const { t } = useTranslation("members")
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
      toast.error(t("failedToLoadMembers"))
    } finally {
      setLoading(false)
    }
  }, [getToken, id, t])

  useEffect(() => { load() }, [load])

  const handleInvite = async () => {
    if (!id || !inviteEmail.trim()) return
    setInviting(true)
    try {
      const token = await getToken()
      if (!token) return
      const created = await apiPost<{ token: string; email: string; link?: string; emailed?: boolean }>(
        `/api/organizations/${id}/members`,
        token,
        { email: inviteEmail.trim(), role: inviteRole },
      )
      const link = created.link ?? `${window.location.origin}/invitations/${created.token}`
      setLastLink(link)
      if (created.emailed) {
        toast.success(t("invitedEmail", { email: created.email }))
      } else {
        toast.success(
          t("invitationCreatedCopyLink", {
            email: created.email,
            defaultValue: "Invitation created for {{email}} — copy the link below to share it.",
          }),
        )
      }
      setInviteEmail("")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("failedToInvite"))
    } finally {
      setInviting(false)
    }
  }

  const handleRoleChange = async (memberId: string, role: string) => {
    if (!id) return
    setBusy(memberId + role)
    const prev = data
    // Update the member's role in place — no full-list refetch/flash.
    setData((d) => (d ? { ...d, members: d.members.map((m) => (m.id === memberId ? { ...m, role } : m)) } : d))
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch(`/api/organizations/${id}/members`, token, { member_id: memberId, role })
      toast.success(t("roleUpdated"))
    } catch (err) {
      setData(prev) // rollback the optimistic change
      toast.error(err instanceof Error ? err.message : t("failed"))
    } finally {
      setBusy(null)
    }
  }

  const handleRemoveMember = async (memberId: string) => {
    if (!id || !window.confirm(t("confirmRemoveMember"))) return
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
      toast.success(t("memberRemoved"))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("failed"))
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
      toast.success(t("invitationRevoked"))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("failed"))
    } finally {
      setBusy(null)
    }
  }

  if (!id) return null
  const canManage = data?.current_role === "owner" || data?.current_role === "admin"
  const canChangeRoles = data?.current_role === "owner"

  return (
    <div className="p-3 sm:p-6 space-y-6 max-w-3xl">
      <Button variant="ghost" size="sm" onClick={() => navigate("/organizations")} className="-ml-2">
        <ArrowLeft className="size-3.5 mr-1.5" /> {t("backToOrganizations")}
      </Button>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{org?.name ?? t("organization")} {t("members")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {t("inviteTeammatesAndManageRoles")} {data?.current_role && (
              <span>{t("youAreAn")} <span className="capitalize font-medium">{data.current_role}</span>.</span>
            )}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => { setInviteEmail(""); setInviteRole("editor"); setLastLink(null); setInviteOpen(true) }} className="shrink-0">
            <Plus className="size-4 sm:mr-1.5" />
            <span className="hidden sm:inline">{t("inviteMember")}</span>
            <span className="sm:hidden">{t("invite")}</span>
          </Button>
        )}
      </div>

      {loading || !data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <Card>
            <CardContent className="py-3">
              <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">{t("membersCount", { count: data.members.length })}</h2>
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
                        className="text-xs bg-background border rounded-md h-9 sm:h-7 px-2"
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
                        className="text-destructive hover:text-destructive size-9 sm:size-8"
                        onClick={() => handleRemoveMember(m.id)}
                        disabled={busy === m.id || m.role === "owner"}
                        aria-label={t("remove")}
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
                <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">{t("pendingInvitationsCount", { count: data.invitations.length })}</h2>
                <div className="divide-y">
                  {data.invitations.map((inv) => (
                    <div key={inv.id} className="py-3 flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Mail className="size-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{inv.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("role")}: <span className="capitalize">{inv.role}</span> ·
                          {inv.expires_at ? ` ${t("expires")} ${inv.expires_at.split("T")[0]}` : ` ${t("noExpiry")}`}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const link = `${window.location.origin}/invitations/${inv.token}`
                          navigator.clipboard.writeText(link)
                          toast.success(t("invitationLinkCopied"))
                        }}
                      >
                        {t("copyLink")}
                      </Button>
                      {canManage && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:text-destructive size-9 sm:size-8"
                          onClick={() => handleRevokeInvite(inv.id)}
                          disabled={busy === inv.id}
                          aria-label={t("revoke")}
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
            <DialogTitle>{t("inviteAMember")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">{t("emailAddress")}</Label>
              <Input id="invite-email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder={t("placeholderEmail")} disabled={inviting} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("role")}</Label>
              <div className="flex gap-1.5">
                {ROLE_OPTIONS.map((r) => (
                  <Button key={r} type="button" size="sm" variant={inviteRole === r ? "default" : "outline"} onClick={() => setInviteRole(r)}>
                    {r === "admin" && <ShieldUser className="size-3.5 mr-1" />}
                    <span className="capitalize">{r}</span>
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("roleDescription")}
              </p>
            </div>
            {lastLink && (
              <div className="text-xs bg-muted rounded-md p-2 break-all">
                <p className="text-muted-foreground mb-1">{t("invitationLinkDescription")}</p>
                <code>{lastLink}</code>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInviteOpen(false)} disabled={inviting}>{t("close")}</Button>
            <Button onClick={handleInvite} disabled={!inviteEmail.trim() || inviting}>
              {inviting ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Plus className="size-3.5 mr-1" />}
              {t("sendInvite")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
