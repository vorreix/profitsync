import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeft, Camera, Check, CircleAlert, Crown, Loader as Loader2, Mic, Sparkles, SendHorizontal, X } from "lucide-react"
import { useAuth } from "@clerk/clerk-react"
import { apiErrorUpgradeHint } from "@/lib/api"
import { parseWithAi, preprocessReceipt, type AiParseResponse } from "@/lib/ai-parse"
import { useVoiceRecorder } from "@/hooks/use-voice-recorder"
import { formatMoney } from "@/lib/wealth"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export type SmartApply = { response: AiParseResponse; receiptFile: File | null; pickedClientId?: string | null }

/**
 * AI quick fill, progressive-disclosure edition. `<AiCaptureView />` is a
 * focused surface the dialog swaps in PLACE of the form body when the header
 * sparkle trigger is tapped (availability comes from `useAiQuota` in
 * src/hooks/use-ai-quota.ts). All AI chrome — text input, voice recording,
 * camera, parsing state, errors, ambiguity chips, quota — lives here and only
 * here; the form never gains a single extra element. Results are applied on
 * the way OUT (including an ambiguous-client resolution step inside this
 * view), and the dialog confirms via toast + transient field highlights.
 */
type Step =
  | { kind: "input" }
  | { kind: "parsing"; hasReceipt: boolean }
  | { kind: "pick-client"; response: AiParseResponse; receiptFile: File | null }
  | { kind: "error"; message: string }

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

export function AiCaptureView({ currency, remaining, costs, voice, maxRecordSeconds, onApply, onClose, onUpgrade, onQuotaUsed }: {
  currency: string
  remaining: number
  costs: { quickadd: number; quickaddMedia: number; assistant: number }
  voice: boolean
  maxRecordSeconds: number
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
  // Monotonic request id: a response only lands if it belongs to the LATEST
  // request (a boolean abort flag couldn't distinguish overlapping calls).
  const reqIdRef = useRef(0)

  const recorder = useVoiceRecorder({
    maxSeconds: maxRecordSeconds,
    onFinish: (wav) => {
      void runParse(
        { text: text.trim() || undefined, audio: { data: wav, media_type: "audio/wav" } },
        null,
      )
    },
    onError: (kind) => setStep({ kind: "error", message: kind === "denied" ? t("ai.micDenied") : t("ai.voiceFailed") }),
  })

  useEffect(() => {
    // Autofocus only where a keyboard won't cover half the sheet.
    if (window.matchMedia("(min-width: 640px)").matches) textRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally bump the CURRENT id at unmount so in-flight responses are dropped
    return () => { reqIdRef.current++ }
  }, [])

  // Out when even the cheapest action no longer fits the balance.
  const exhausted = remaining < costs.quickadd
  const recording = recorder.state === "recording"
  const transcoding = recorder.state === "processing"
  const parsing = step.kind === "parsing" || transcoding
  const canSend = text.trim().length > 0 && !parsing && !recording && !exhausted

  async function runParse(
    input: { text?: string; image?: { data: string; media_type: string }; audio?: { data: string; media_type: string } },
    receiptFile: File | null,
  ) {
    const reqId = ++reqIdRef.current
    setStep({ kind: "parsing", hasReceipt: receiptFile != null })
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const response = await parseWithAi(token, input)
      if (reqIdRef.current !== reqId) return
      onQuotaUsed(response.remaining)
      if (response.client_candidates && response.client_candidates.length > 0) {
        // Resolve ambiguity HERE, before anything touches the form.
        setStep({ kind: "pick-client", response, receiptFile })
        return
      }
      onApply({ response, receiptFile })
      onClose()
    } catch (err) {
      if (reqIdRef.current !== reqId) return
      // 403+upgradeHint = this action costs more than the remaining balance.
      // Don't zero the visible balance — cheaper actions may still fit.
      if (apiErrorUpgradeHint(err)) { setStep({ kind: "error", message: t("ai.notEnoughCredits") }); return }
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
    <div className="flex min-h-[16rem] flex-col animate-in fade-in duration-200 motion-reduce:animate-none">
      <div className="mb-3 flex items-center gap-1">
        <Button variant="ghost" size="icon" className="-ms-2 size-9" aria-label={t("cancel")} onClick={() => { recorder.cancel(); onClose() }}>
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
          <div className="flex size-12 items-center justify-center rounded-full bg-amber-500/15">
            <Crown className="size-6 text-amber-500 dark:text-amber-400" aria-hidden />
          </div>
          <p className="max-w-[24rem] text-sm text-muted-foreground">{t("ai.quotaExhausted")}</p>
          <Button onClick={onUpgrade}>
            <Crown className="me-2 size-4" /> {t("ai.upgrade")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-3">
          {recording ? (
            /* ── Recording: replaces the input box, same footprint ────────── */
            <div className="relative overflow-hidden rounded-xl border">
              <div className="flex min-h-24 items-center justify-between gap-3 p-4 pb-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="relative flex size-3 shrink-0" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60 motion-reduce:hidden" />
                    <span className="relative inline-flex size-3 rounded-full bg-red-500" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{t("ai.recording")}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {fmtClock(recorder.elapsed)} / {fmtClock(maxRecordSeconds)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button" variant="outline" size="icon" className="size-11 rounded-full"
                    aria-label={t("cancel")} onClick={recorder.cancel}
                  >
                    <X className="size-4" />
                  </Button>
                  <Button
                    type="button" size="icon" className="size-11 rounded-full"
                    aria-label={t("ai.stop")} onClick={recorder.stop}
                  >
                    <Check className="size-5" />
                  </Button>
                </div>
              </div>
              <div className="absolute inset-x-0 bottom-0 h-1 bg-muted" aria-hidden>
                <div
                  className="h-full origin-left bg-red-500/80 transition-transform duration-200 ease-linear rtl:origin-right"
                  style={{ transform: `scaleX(${Math.min(1, recorder.elapsed / maxRecordSeconds)})` }}
                />
              </div>
            </div>
          ) : (
            /* ── Idle / parsing: textarea with mic-or-send action ─────────── */
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
                className="min-h-24 resize-none border-0 bg-transparent pb-14 text-base shadow-none focus-visible:ring-0 md:text-sm"
              />
              {canSend ? (
                <Button
                  type="button" size="icon" className="absolute bottom-2 end-2 size-11"
                  aria-label={t("ai.parse")}
                  onClick={() => void runParse({ text: text.trim() }, null)}
                >
                  <SendHorizontal className="size-4 rtl:-scale-x-100" />
                </Button>
              ) : voice && !parsing && remaining >= costs.quickaddMedia ? (
                <Button
                  type="button" variant="ghost" size="icon" className="absolute bottom-2 end-2 size-11 text-muted-foreground"
                  aria-label={t("ai.speak")}
                  onClick={() => { setStep({ kind: "input" }); void recorder.start() }}
                >
                  <Mic className="size-5" />
                </Button>
              ) : null}
            </div>
          )}

          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onReceiptPick} />
          <Button
            type="button" variant="outline" className="h-11 w-full"
            disabled={parsing || recording || remaining < costs.quickaddMedia}
            onClick={() => cameraRef.current?.click()}
          >
            <Camera className="me-2 size-4" /> {t("ai.cameraLabel")}
          </Button>

          <div aria-live="polite" className="min-h-5">
            {parsing && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin motion-reduce:animate-none" /> {t("ai.parsing")}
              </p>
            )}
            {step.kind === "error" && !recording && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <CircleAlert className="size-3 shrink-0" /> {step.message}
              </p>
            )}
          </div>

          {remaining <= costs.quickaddMedia * 3 && !parsing && (
            <p className="mt-auto text-center text-xs text-muted-foreground">{t("ai.quotaLow", { count: remaining })}</p>
          )}
        </div>
      )}
    </div>
  )
}
