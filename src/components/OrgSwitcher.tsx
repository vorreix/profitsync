import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Building2, Check, ChevronsUpDown, Plus, Search, Loader as Loader2, Sparkles } from "lucide-react"
import { useOrg } from "@/lib/org-context"
import { isPaidPlanKey } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { EntityAvatar } from "@/components/EntityAvatar"

const ROLE_LABEL_KEYS: Record<string, string> = {
  owner: "org.roleOwner",
  admin: "org.roleAdmin",
  editor: "org.roleEditor",
  viewer: "org.roleViewer",
}

export function OrgSwitcher() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { orgs, activeOrg, switchOrg, refresh, loading } = useOrg()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const filtered = orgs.filter((o) => o.name.toLowerCase().includes(search.toLowerCase().trim()))

  const handleSwitch = async (id: string) => {
    try {
      await switchOrg(id)
      await refresh()
      setOpen(false)
      navigate("/dashboard")
    } catch {
      toast.error(t("organizations.failedToSwitchOrganization"))
    }
  }

  const roleLabel = (role: string | null | undefined) => {
    if (!role) return t("org.roleOwner")
    const key = ROLE_LABEL_KEYS[role]
    return key ? t(key) : role
  }

  if (loading && !activeOrg) {
    return (
      <div className="px-2 py-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        <span className="group-data-[collapsible=icon]:hidden">{t("org.loading")}</span>
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between px-2 h-auto py-2 hover:bg-accent group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:size-10 group-data-[collapsible=icon]:justify-center"
          aria-label={t("org.switchOrganization")}
        >
          <div className="flex items-center gap-2 min-w-0">
            <EntityAvatar
              name={activeOrg?.name ?? "Personal"}
              src={activeOrg?.logo_src}
              className="size-7 text-xs"
              fallbackIcon={<Building2 className="size-3.5" />}
            />
            <div className="text-left min-w-0 group-data-[collapsible=icon]:hidden">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-medium leading-tight truncate">{activeOrg?.name ?? t("org.personal")}</p>
                {activeOrg && (
                  <span
                    className={`text-[9px] uppercase tracking-wider px-1 py-0.5 rounded-sm border shrink-0 leading-none ${
                      isPaidPlanKey(activeOrg.plan_key)
                        ? "border-amber-500/40 text-amber-600 bg-amber-500/10 dark:text-amber-300"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {isPaidPlanKey(activeOrg.plan_key) ? t("org.pro") : t("org.free")}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{roleLabel(activeOrg?.role)}</p>
            </div>
          </div>
          <ChevronsUpDown className="size-3.5 opacity-50 group-data-[collapsible=icon]:hidden" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex max-h-[min(30rem,75vh)] w-72 flex-col p-0" align="start">
        <div className="shrink-0 border-b p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder={t("org.searchOrganizations")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
              autoFocus
            />
          </div>
        </div>
        {/* Plain scroll container (not Radix ScrollArea) so it reliably constrains
            inside the flex column — otherwise a long org list overflows and overlaps
            the footer actions below. */}
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <div className="p-1">
            {filtered.length === 0 ? (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">{t("org.noOrganizationsMatch")}</div>
            ) : (
              filtered.map((org) => (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => handleSwitch(org.id)}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-accent text-left"
                >
                  <EntityAvatar
                    name={org.name}
                    src={org.logo_src}
                    className="size-7 text-xs"
                    fallbackIcon={<Building2 className="size-3.5" />}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate">{org.name}</p>
                      {org.is_personal && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground border rounded-sm px-1">{t("org.personal")}</span>
                      )}
                      <span
                        className={`text-[10px] uppercase tracking-wide px-1 rounded-sm border ${
                          isPaidPlanKey(org.plan_key)
                            ? "border-amber-500/40 text-amber-600 bg-amber-500/10 dark:text-amber-300"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {isPaidPlanKey(org.plan_key) ? t("org.pro") : t("org.free")}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{roleLabel(org.role)}</p>
                  </div>
                  {org.id === activeOrg?.id && <Check className="size-4 text-primary" />}
                </button>
              ))
            )}
          </div>
        </div>
        <div className="shrink-0 border-t p-1 flex flex-col">
          {activeOrg && !isPaidPlanKey(activeOrg.plan_key) && (
            <Button
              variant="ghost"
              className="justify-start gap-2 px-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300"
              onClick={() => { setOpen(false); navigate("/subscription") }}
            >
              <Sparkles className="size-4" />
              <span className="text-sm font-medium">{t("org.upgradeTitle")}</span>
            </Button>
          )}
          {/* Creation is immersed in the setup wizard (name → money → plan), so the
              Back/Skip buttons there have real meaning. */}
          <Button variant="ghost" className="justify-start gap-2 px-2" onClick={() => { setOpen(false); navigate("/organization-setup") }}>
            <Plus className="size-4" />
            <span className="text-sm">{t("org.createOrganization")}</span>
          </Button>
          <Button variant="ghost" className="justify-start gap-2 px-2" onClick={() => { setOpen(false); navigate("/organizations") }}>
            <Building2 className="size-4" />
            <span className="text-sm">{t("org.manageOrganizations")}</span>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
