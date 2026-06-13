import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { apiPatch, apiPost } from "@/lib/api"
import type { WealthAccount } from "@/lib/types"
import { SPACE_ICONS } from "@/components/wealth/space-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const todayIso = () => new Date().toISOString().split("T")[0]
type SpaceForm = { name: string; goal: string; date: string; icon: string }

/**
 * Create or edit a Space (name, savings icon, optional goal + target date).
 * `space=null` → create. Self-contained: POST/PATCH + toast; hands the saved row
 * back via onSaved. Shared by the Spaces list and the Space detail page.
 */
export function SpaceFormModal({
  open, space, onClose, onSaved,
}: {
  open: boolean
  space: WealthAccount | null
  onClose: () => void
  onSaved: (saved: WealthAccount, isNew: boolean) => void
}) {
  const { t } = useTranslation("spaces")
  const { getToken } = useAuth()
  const [form, setForm] = useState<SpaceForm>({ name: "", goal: "", date: "", icon: "piggy" })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setSaving(false)
    setForm(space
      ? { name: space.nickname, goal: space.goal_amount != null ? String(space.goal_amount) : "", date: space.target_date ?? "", icon: space.icon || "piggy" }
      : { name: "", goal: "", date: "", icon: "piggy" })
  }, [open, space])

  async function handleSave() {
    if (!form.name.trim()) { toast.error(t("nameRequired")); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("auth")
      const body = { name: form.name.trim(), goal_amount: form.goal === "" ? null : Number(form.goal), target_date: form.date || null, icon: form.icon }
      if (space) {
        const updated = await apiPatch<WealthAccount>(`/api/spaces/${space.id}`, token, body, ["/api/spaces", "/api/wealth"])
        toast.success(t("updated"))
        onSaved(updated, false)
      } else {
        const created = await apiPost<WealthAccount>("/api/spaces", token, body, ["/api/spaces", "/api/wealth"])
        toast.success(t("created"))
        onSaved(created, true)
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error && err.message && err.message !== "auth" ? err.message : t("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl">
        <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6">
          <DialogTitle>{space ? t("editTitle") : t("newSpace")}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-6 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="space-name">{t("nameLabel")}</Label>
            <Input id="space-name" value={form.name} maxLength={60} placeholder={t("namePlaceholder")} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>{t("iconLabel")}</Label>
            <div className="flex flex-wrap gap-2">
              {SPACE_ICONS.map(({ key, Icon }) => (
                <button
                  key={key}
                  type="button"
                  aria-label={key}
                  onClick={() => setForm((f) => ({ ...f, icon: key }))}
                  className={`flex size-11 items-center justify-center rounded-xl border transition-colors ${form.icon === key ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "text-muted-foreground hover:bg-muted"}`}
                >
                  <Icon className="size-5" />
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="space-goal">{t("goalLabel")}</Label>
              <Input id="space-goal" type="number" inputMode="decimal" min="0" step="0.01" placeholder={t("goalOptional")} value={form.goal} onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="space-date">{t("targetDateLabel")}</Label>
              <Input id="space-date" type="date" min={todayIso()} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("goalHint")}</p>
        </div>
        <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>{t("cancel")}</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? t("saving") : space ? t("save") : t("create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
