import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { AlertTriangle, Loader as Loader2, RotateCcw } from "lucide-react"

import { apiPost, clearApiCache } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Factory-reset ("Reset all data") confirmation. Intentional-by-design: the
 * destructive button stays disabled until the user types the confirmation word,
 * so it can't be triggered by an accidental tap. On success the whole workspace
 * is wiped to a clean first-use state and the user is sent to onboarding — the
 * session/login is kept (unlike DeleteAccountDialog, there is no signOut).
 */
export function ResetDataDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { refresh } = useOrg()
  const navigate = useNavigate()

  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)

  const confirmWord = t("resetData.confirmWord")
  const confirmed = typed.trim().toLowerCase() === confirmWord.trim().toLowerCase()

  // Clear the typed word every time the dialog opens, so it re-arms.
  useEffect(() => {
    if (open) setTyped("")
  }, [open])

  const handleConfirm = async () => {
    if (!confirmed) return
    setBusy(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost("/api/account/reset", token, {})
      // Drop any cached GETs so nothing stale shows post-reset, refresh the
      // shared profile/org state (now onboarded_at === null), then land the
      // user in the clean first-use flow. Session/login is untouched.
      clearApiCache()
      await refresh()
      toast.success(t("resetData.success"))
      onOpenChange(false)
      navigate("/onboarding")
    } catch {
      toast.error(t("resetData.error"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive">{t("resetData.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("resetData.dialogWarning")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-sm text-muted-foreground">{t("resetData.finalWarning")}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reset-confirm">{t("resetData.confirmPrompt", { word: confirmWord })}</Label>
          <Input
            id="reset-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
            placeholder={confirmWord}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={busy || !confirmed}>
            {busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <RotateCcw className="mr-1.5 size-4" />}
            {busy ? t("resetData.resetting") : t("resetData.confirmButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
