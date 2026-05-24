import { useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Building2, Check, ChevronsUpDown, Plus, Search, Loader as Loader2 } from "lucide-react"
import { useOrg } from "@/lib/org-context"
import { apiPost } from "@/lib/api"
import type { Organization } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function OrgSwitcher() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { orgs, activeOrg, switchOrg, refresh, loading } = useOrg()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)

  const filtered = orgs.filter((o) => o.name.toLowerCase().includes(search.toLowerCase().trim()))

  const handleSwitch = async (id: string) => {
    try {
      await switchOrg(id)
      await refresh()
      setOpen(false)
      navigate("/dashboard")
    } catch {
      toast.error("Failed to switch organization")
    }
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const created = await apiPost<Organization>("/api/organizations", token, { name: newName.trim() })
      toast.success(`Organization "${created.name}" created`)
      setCreateOpen(false)
      setOpen(false)
      setNewName("")
      await switchOrg(created.id)
      await refresh()
      navigate("/dashboard")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create organization")
    } finally {
      setCreating(false)
    }
  }

  if (loading && !activeOrg) {
    return (
      <div className="px-2 py-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        <span className="group-data-[collapsible=icon]:hidden">Loading…</span>
      </div>
    )
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-between px-2 h-auto py-2 hover:bg-accent group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:size-10 group-data-[collapsible=icon]:justify-center"
            aria-label="Switch organization"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                <Building2 className="size-3.5" />
              </div>
              <div className="text-left min-w-0 group-data-[collapsible=icon]:hidden">
                <p className="text-xs font-medium leading-tight truncate">{activeOrg?.name ?? "Personal"}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{activeOrg?.role ?? "owner"}</p>
              </div>
            </div>
            <ChevronsUpDown className="size-3.5 opacity-50 group-data-[collapsible=icon]:hidden" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Search organizations…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
                autoFocus
              />
            </div>
          </div>
          <ScrollArea className="max-h-64">
            <div className="p-1">
              {filtered.length === 0 ? (
                <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                  No organizations match
                </div>
              ) : (
                filtered.map((org) => (
                  <button
                    key={org.id}
                    type="button"
                    onClick={() => handleSwitch(org.id)}
                    className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-accent text-left"
                  >
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                      <Building2 className="size-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium truncate">{org.name}</p>
                        {org.is_personal && (
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground border rounded-sm px-1">
                            Personal
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{org.role}</p>
                    </div>
                    {org.id === activeOrg?.id && <Check className="size-4 text-primary" />}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
          <div className="border-t p-1 flex flex-col">
            <Button
              variant="ghost"
              className="justify-start gap-2 px-2"
              onClick={() => {
                setOpen(false)
                setCreateOpen(true)
              }}
            >
              <Plus className="size-4" />
              <span className="text-sm">Create organization</span>
            </Button>
            <Button
              variant="ghost"
              className="justify-start gap-2 px-2"
              onClick={() => {
                setOpen(false)
                navigate("/organizations")
              }}
            >
              <Building2 className="size-4" />
              <span className="text-sm">Manage organizations</span>
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a new organization</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="org-name">Organization name</Label>
            <Input
              id="org-name"
              placeholder="Acme Inc."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) handleCreate()
              }}
              disabled={creating}
            />
            <p className="text-xs text-muted-foreground">
              You'll become the owner. Each organization has its own clients, transactions, and quotations.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Plus className="size-4 mr-2" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
