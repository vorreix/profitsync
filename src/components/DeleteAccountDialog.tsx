import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth, useClerk } from "@clerk/clerk-react"
import { apiGet, apiPost, setActiveOrgId } from "@/lib/api"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { AlertTriangle, Building2, Loader as Loader2, MailCheck, Users } from "lucide-react"

type DeleteSummary = {
  organizations: { id: string; name: string; is_personal: boolean; member_count: number; has_active_premium: boolean }[]
  other_memberships: number
}

/** The API client throws the raw response body — pull out our machine-readable fields. */
function apiErrorPayload(err: unknown): { code?: string; retry_after?: number; attempts_left?: number } {
  if (err instanceof Error && err.message.trim().startsWith("{")) {
    try {
      return JSON.parse(err.message) as { code?: string; retry_after?: number; attempts_left?: number }
    } catch {
      /* not JSON */
    }
  }
  return {}
}

/**
 * Two-step delete-account flow: consequences → emailed 6-digit code. Always
 * mounted + state-driven (the shadcn Dialog root wires Back-gesture close).
 */
export function DeleteAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { signOut } = useClerk()

  const [step, setStep] = useState<"confirm" | "otp">("confirm")
  const [summary, setSummary] = useState<DeleteSummary | null>(null)
  const [maskedEmail, setMaskedEmail] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [resendWait, setResendWait] = useState(0)

  // 1s countdown for the resend cooldown.
  useEffect(() => {
    if (resendWait <= 0) return
    const id = setTimeout(() => setResendWait(resendWait - 1), 1000)
    return () => clearTimeout(id)
  }, [resendWait])

  // Reset + load the consequences summary each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setStep("confirm")
    setSummary(null)
    setCode("")
    setError(null)
    setUnavailable(false)
    setResendWait(0)
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        setSummary(await apiGet<DeleteSummary>("/api/account/delete/summary", token))
      } catch {
        toast.error(t("deleteAccount.loadFailed"))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open
  }, [open])

  const requestCode = async (): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const res = await apiPost<{ email: string }>("/api/account/delete/request-code", token, {})
      setMaskedEmail(res.email)
      setResendWait(60)
      return true
    } catch (err) {
      const payload = apiErrorPayload(err)
      if (payload.code === "email_unavailable") {
        setUnavailable(true)
        return true // still advance; the OTP step renders the unavailable notice
      }
      if (payload.code === "cooldown") {
        setResendWait(payload.retry_after ?? 60)
        return true // a code from the previous send is still live — let them type it
      }
      setError(t("deleteAccount.emailFailed"))
      return false
    } finally {
      setBusy(false)
    }
  }

  const handleContinue = async () => {
    if (await requestCode()) setStep("otp")
  }

  const handleConfirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost("/api/account/delete/confirm", token, { code })
      toast.success(t("deleteAccount.deleted"))
      setActiveOrgId(null)
      try {
        await signOut()
      } catch {
        /* the server session may already be gone — local state is cleared regardless */
      }
      window.location.replace("/")
    } catch (err) {
      const payload = apiErrorPayload(err)
      setCode("")
      if (payload.code === "invalid_code") setError(t("deleteAccount.invalidCode", { count: payload.attempts_left ?? 0 }))
      else if (payload.code === "expired") setError(t("deleteAccount.expiredCode"))
      else if (payload.code === "too_many_attempts") setError(t("deleteAccount.tooManyAttempts"))
      else setError(t("deleteAccount.failed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-md">
        {step === "confirm" ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-destructive">{t("deleteAccount.dialogTitle")}</DialogTitle>
              <DialogDescription>{t("deleteAccount.consequences")}</DialogDescription>
            </DialogHeader>
            {summary === null ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {summary.organizations.map((org) => (
                  <div
                    key={org.id}
                    className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5"
                  >
                    <Building2 className="size-4 mt-0.5 shrink-0 text-destructive" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {org.is_personal ? t("deleteAccount.personalWorkspace") : org.name}
                      </p>
                      {org.member_count > 1 && (
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="size-3" />
                          {t("deleteAccount.memberCount", { count: org.member_count })}
                        </p>
                      )}
                      {org.has_active_premium && (
                        <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="size-3" />
                          {t("deleteAccount.premiumWarning")}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                {summary.other_memberships > 0 && (
                  <p className="text-xs text-muted-foreground px-1">
                    {t("deleteAccount.membershipsRemoved", { count: summary.other_memberships })}
                  </p>
                )}
                <p className="text-xs text-muted-foreground px-1">{t("deleteAccount.finalWarning")}</p>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button variant="destructive" onClick={handleContinue} disabled={busy || summary === null}>
                {busy ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : null}
                {t("deleteAccount.continue")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-destructive">{t("deleteAccount.otpTitle")}</DialogTitle>
              <DialogDescription>
                {unavailable ? t("deleteAccount.unavailable") : t("deleteAccount.otpSent", { email: maskedEmail })}
              </DialogDescription>
            </DialogHeader>
            {!unavailable && (
              <div className="flex flex-col items-center gap-3 py-2">
                <MailCheck className="size-8 text-muted-foreground" />
                <InputOTP maxLength={6} value={code} onChange={setCode} disabled={busy}>
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <InputOTPSlot key={i} index={i} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
                {error && <p className="text-sm text-destructive text-center">{error}</p>}
                <Button
                  variant="link"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={busy || resendWait > 0}
                  onClick={requestCode}
                >
                  {resendWait > 0 ? t("deleteAccount.resendIn", { seconds: resendWait }) : t("deleteAccount.resend")}
                </Button>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                {t("common.cancel")}
              </Button>
              {!unavailable && (
                <Button variant="destructive" onClick={handleConfirm} disabled={busy || code.length !== 6}>
                  {busy ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : null}
                  {busy ? t("deleteAccount.deleting") : t("deleteAccount.confirmButton")}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
