import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeft, Camera, CircleAlert, Loader as Loader2, Sparkles, SendHorizontal } from "lucide-react"
import { useAuth } from "@clerk/clerk-react"
import { apiErrorUpgradeHint } from "@/lib/api"
import { parseWithAi, preprocessReceipt, type AiParseResponse } from "@/lib/ai-parse"
import { formatMoney } from "@/lib/wealth"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export type SmartApply = { response: AiParseResponse; receiptFile: File | null; pickedClientId?: string | null }

/**
 * AI quick fill, progressive-disclosure edition. `<AiCaptureView />` is a
 * focused surface the dialog swaps in PLACE of the form body when the header
 * sparkle trigger is tapped (availability comes from `useAiQuota` in
 * src/hooks/use-ai-quota.ts). All AI chrome — input, camera, parsing state,
 * errors, ambiguity chips, quota — lives here and only here; the form never
 * gains a single extra element. Results are applied on the way OUT (including
 * an ambiguous-client resolution step inside this view), and the dialog
 * confirms via toast + transient field highlights.
 */
type Step =
  | { kind: "input" }
  | { kind: "parsing"; hasReceipt: boolean }
  | { kind: "pick-client"; response: AiParseResponse; receiptFile: File | null }
  | { kind: "error"; message: string }

export function AiCaptureView({ currency, remaining, limit, onApply, onClose, onUpgrade, onQuotaUsed }: {
  currency: string
  remaining: number
  limit: number
  onApply: (a: SmartApply) => void
  onClose: () => void
  onUpgrade: () => void
  onQuotaUsed: (remaining: number) => void
}) {
  const { t } = useTranslation("transactions")
  const { getToken } = useAuth()
  const [text, setText] = useState("")
  const [step, setStep] = useState<Step>({ kind: "input" })
  const cameraRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef(false)

  useEffect(() => {
    // Autofocus only where a keyboard won't cover half the sheet.
    if (window.matchMedia("(min-width: 640px)").matches) textRef.current?.focus()
    return () => { abortRef.current = true }
  }, [])

  const exhausted = remaining <= 0
  const parsing = step.kind === "parsing"
  const canSend = text.trim().length > 0 && !parsing && !exhausted

  async function runParse(input: { text?: string; image?: { data: string; media_type: string } }, receiptFile: File | null) {
    abortRef.current = false
    setStep({ kind: "parsing", hasReceipt: receiptFile != null })
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const response = await parseWithAi(token, input)
      if (abortRef.current) return
      onQuotaUsed(response.remaining)
      if (response.client_candidates && response.client_candidates.length > 0) {
        // Resolve ambiguity HERE, before anything touches the form.
        setStep({ kind: "pick-client", response, receiptFile })
        return
      }
      onApply({ response, receiptFile })
      onClose()
    } catch (err) {
      if (abortRef.current) return
      if (apiErrorUpgradeHint(err)) { onQuotaUsed(0); setStep({ kind: "input" }); return }
      const unparseable = err instanceof Error && err.message.includes("unparseable")
      setStep({
        kind: "error",
        message: unparseable
          ? receiptFile ? t("ai.receiptUnreadable") : t("ai.errorUnparseable")
          : t("ai.errorGeneric"),
      })
    }
  }

  async function onReceiptPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    try {
      const processed = await preprocessReceipt(file)
      void runParse(
        { text: text.trim() || undefined, image: { data: processed.data, media_type: processed.media_type } },
        processed.file,
      )
    } catch {
      setStep({ kind: "error", message: t("ai.errorGeneric") })
    }
  }

  return (
    <div className="flex min-h-[16rem] flex-col animate-in fade-in duration-200">
      <div className="mb-3 flex items-center gap-1">
        <Button variant="ghost" size="icon" className="-ms-2 size-9" aria-label={t("cancel")} onClick={onClose}>
          <ArrowLeft className="size-4 rtl:-scale-x-100" />
        </Button>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="size-4 text-primary" aria-hidden /> {t("ai.parse")}
        </p>
      </div>

      {step.kind === "pick-client" ? (
        <div className="flex flex-1 flex-col gap-3" aria-live="polite">
          <p className="text-sm text-muted-foreground">{t("ai.didYouMean")}</p>
          <div className="flex flex-col gap-2">
            {step.response.client_candidates!.map((c) => (
              <Button
                key={c.id} variant="outline" className="h-11 justify-start"
                onClick={() => { onApply({ response: step.response, receiptFile: step.receiptFile, pickedClientId: c.id }); onClose() }}
              >
                <span className="truncate">{c.name}</span>
              </Button>
            ))}
            <Button
              variant="ghost" className="h-11 justify-start text-muted-foreground"
              onClick={() => { onApply({ response: step.response, receiptFile: step.receiptFile, pickedClientId: null }); onClose() }}
            >
              {t("ai.none")}
            </Button>
          </div>
        </div>
      ) : exhausted ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Sparkles className="size-6 text-primary" aria-hidden />
          <p className="max-w-[24rem] text-sm text-muted-foreground">{t("ai.quotaExhausted", { count: limit })}</p>
          <Button onClick={onUpgrade}>{t("ai.upgrade")}</Button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-3">
          <div className={`relative rounded-xl border ${parsing ? "ai-shimmer-border" : ""}`}>
            <Textarea
              ref={textRef}
              value={text}
              onChange={(e) => { setText(e.target.value); if (step.kind === "error") setStep({ kind: "input" }) }}
              placeholder={t("ai.placeholder", { example: formatMoney(450, currency) })}
              rows={3}
              enterKeyHint="go"
              disabled={parsing}
              aria-label={t("ai.inputLabel")}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && canSend) { e.preventDefault(); void runParse({ text: text.trim() }, null) }
              }}
              className="min-h-24 resize-none border-0 bg-transparent text-base shadow-none focus-visible:ring-0 md:text-sm"
            />
            {canSend && (
              <Button
                type="button" size="icon" className="absolute bottom-2 end-2 size-9"
                aria-label={t("ai.parse")}
                onClick={() => void runParse({ text: text.trim() }, null)}
              >
                <SendHorizontal className="size-4 rtl:-scale-x-100" />
              </Button>
            )}
          </div>

          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onReceiptPick} />
          <Button
            type="button" variant="outline" className="h-11 w-full"
            disabled={parsing}
            onClick={() => cameraRef.current?.click()}
          >
            <Camera className="me-2 size-4" /> {t("ai.cameraLabel")}
          </Button>

          <div aria-live="polite" className="min-h-5">
            {parsing && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> {t("ai.parsing")}
              </p>
            )}
            {step.kind === "error" && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <CircleAlert className="size-3 shrink-0" /> {step.message}
              </p>
            )}
          </div>

          {remaining <= 5 && !parsing && (
            <p className="mt-auto text-center text-xs text-muted-foreground">{t("ai.quotaLow", { count: remaining })}</p>
          )}
        </div>
      )}
    </div>
  )
}
