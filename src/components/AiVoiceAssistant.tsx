import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { Check, CircleAlert, Crown, Loader as Loader2, Mic, Sparkles, X } from "lucide-react"
import { apiErrorUpgradeHint } from "@/lib/api"
import { askAssistant, ASSISTANT_WAV_RATE, type AiAssistantResponse, type AiQuota } from "@/lib/ai-parse"
import { useVoiceRecorder } from "@/hooks/use-voice-recorder"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

const BAR_COUNT = 27

/**
 * The floating AI voice assistant (mobile): a small mic button that lives just
 * above the FAB. Tapping it blurs the screen and starts listening immediately —
 * big mic, a LIVE waveform (level-driven bars that collapse to dots in
 * silence), a countdown against the plan's ceiling, and one short note:
 * "ask anything, any language". The model classifies the intent
 * (transaction / client / quotation / show transactions) and this component
 * hands the payload back to MobileAppLayout, which opens the matching
 * PREFILLED create dialog or navigates with filters — the assistant itself
 * never writes anything.
 *
 * Built on Dialog so focus-trap, Esc and the app's back-close behavior come
 * for free; the content is restyled into a fullscreen blurred surface.
 */
export function AiVoiceAssistant({ quota, onResult, onQuotaUsed }: {
  quota: AiQuota | null
  onResult: (r: AiAssistantResponse) => void
  onQuotaUsed: (remaining: number) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<"listening" | "asking" | "error">("listening")
  const [errorMsg, setErrorMsg] = useState("")
  // Monotonic request id — a response only lands for the latest ask.
  const reqIdRef = useRef(0)

  // ── Live waveform: AnalyserNode → level ring buffer → bars ────────────────
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef(0)
  const levelsRef = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => 0))
  const barRefs = useRef<(HTMLDivElement | null)[]>([])

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    void audioCtxRef.current?.close().catch(() => undefined)
    audioCtxRef.current = null
  }, [])

  const startMeter = useCallback((stream: MediaStream) => {
    stopMeter()
    try {
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Uint8Array(analyser.fftSize)
      let last = 0
      const tick = (now: number) => {
        rafRef.current = requestAnimationFrame(tick)
        if (now - last < 50) return // ~20fps is plenty for a waveform
        last = now
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128
          sum += v * v
        }
        // RMS → perceptual-ish level; speech sits ~0.02-0.3.
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 4)
        const levels = levelsRef.current
        levels.push(level)
        levels.shift()
        // Imperative transform updates — no React re-render per frame.
        for (let i = 0; i < BAR_COUNT; i++) {
          const el = barRefs.current[i]
          if (el) el.style.transform = `scaleY(${Math.max(0.12, levels[i])})`
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch {
      // Waveform is decorative — recording works without it.
    }
  }, [stopMeter])

  const runAsk = useCallback(async (wavBase64: string) => {
    const reqId = ++reqIdRef.current
    setPhase("asking")
    try {
      const token = await getToken()
      if (!token) throw new Error("not authenticated")
      const response = await askAssistant(token, { audio: { data: wavBase64, media_type: "audio/wav" } })
      if (reqIdRef.current !== reqId) return
      onQuotaUsed(response.remaining)
      setOpen(false)
      onResult(response)
    } catch (err) {
      if (reqIdRef.current !== reqId) return
      if (apiErrorUpgradeHint(err)) {
        onQuotaUsed(0)
        setPhase("listening") // quota view takes over via remaining=0
        return
      }
      const unparseable = err instanceof Error && err.message.includes("unparseable")
      setErrorMsg(unparseable ? t("aiVoice.notUnderstood") : t("aiVoice.failed"))
      setPhase("error")
    }
  }, [getToken, onQuotaUsed, onResult, t])

  const maxSeconds = quota?.assistant_max_record_seconds || 30
  const recorder = useVoiceRecorder({
    maxSeconds,
    sampleRate: ASSISTANT_WAV_RATE,
    onFinish: (wav) => { stopMeter(); void runAsk(wav) },
    onStream: startMeter,
    onError: (kind) => {
      stopMeter()
      setErrorMsg(kind === "denied" ? t("transactions:ai.micDenied") : t("aiVoice.failed"))
      setPhase("error")
    },
  })
  // The hook identity changes across renders; keep stable handles for effects.
  const recorderRef = useRef(recorder)
  recorderRef.current = recorder

  const cost = quota?.costs.assistant ?? 2
  const exhausted = (quota?.remaining ?? 0) < cost

  // Unmount safety: never leave the meter's AudioContext running.
  useEffect(() => () => { reqIdRef.current++; stopMeter() }, [stopMeter])

  // Opening the overlay starts listening immediately (one tap to talk).
  useEffect(() => {
    if (!open) {
      reqIdRef.current++
      recorderRef.current.cancel()
      stopMeter()
      return
    }
    setErrorMsg("")
    setPhase("listening")
    levelsRef.current = Array.from({ length: BAR_COUNT }, () => 0)
    if (!exhausted) void recorderRef.current.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!quota?.enabled || !quota.voice) return null
  const free = quota.plan_key === "free"
  const recording = recorder.state === "recording"

  return (
    <>
      {/* Floating trigger, stacked just above the FAB. */}
      <Button
        type="button"
        size="icon"
        variant="outline"
        aria-label={t("aiVoice.openLabel")}
        onClick={() => setOpen(true)}
        className="relative size-11 rounded-full border bg-background/95 shadow-lg backdrop-blur"
      >
        <Mic className={`size-5 ${free ? "text-amber-500 dark:text-amber-400" : "text-primary"}`} />
        <Sparkles
          className={`absolute -end-0.5 -top-0.5 size-3.5 ${free ? "text-amber-500 dark:text-amber-400" : "text-primary"}`}
          aria-hidden
        />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="inset-0 top-0 left-0 flex h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col items-center justify-center gap-0 rounded-none border-0 bg-background/70 p-6 backdrop-blur-xl safe-pb"
        >
          <DialogTitle className="sr-only">{t("aiVoice.openLabel")}</DialogTitle>

          {exhausted ? (
            /* ── Out of credits ──────────────────────────────────────────── */
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-amber-500/15">
                <Crown className="size-8 text-amber-500 dark:text-amber-400" aria-hidden />
              </div>
              <p className="max-w-[22rem] text-sm text-muted-foreground">
                {t("transactions:ai.quotaExhausted", { count: quota.limit })}
              </p>
              <Button onClick={() => { setOpen(false); navigate("/subscription") }}>
                <Crown className="me-2 size-4" /> {t("transactions:ai.upgrade")}
              </Button>
            </div>
          ) : phase === "error" ? (
            /* ── Error, with a retry that starts listening again ─────────── */
            <div className="flex flex-col items-center gap-4 text-center" aria-live="polite">
              <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10">
                <CircleAlert className="size-8 text-destructive" aria-hidden />
              </div>
              <p className="max-w-[22rem] text-sm text-muted-foreground">{errorMsg}</p>
              <Button onClick={() => { setErrorMsg(""); setPhase("listening"); void recorder.start() }}>
                <Mic className="me-2 size-4" /> {t("aiVoice.tryAgain")}
              </Button>
            </div>
          ) : phase === "asking" ? (
            /* ── Thinking ────────────────────────────────────────────────── */
            <div className="flex flex-col items-center gap-4 text-center" aria-live="polite">
              <div className="flex size-20 items-center justify-center rounded-full bg-primary/10">
                <Loader2 className="size-8 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
              </div>
              <p className="text-sm font-medium">{t("aiVoice.thinking")}</p>
            </div>
          ) : (
            /* ── Listening: mic + live waveform + timer + controls ───────── */
            <div className="flex w-full max-w-sm flex-col items-center gap-6">
              <div className="relative flex size-20 items-center justify-center rounded-full bg-primary/10">
                {recording && (
                  <span className="absolute inset-0 animate-ping rounded-full bg-primary/20 motion-reduce:hidden" aria-hidden />
                )}
                <Mic className="size-9 text-primary" aria-hidden />
              </div>

              {/* Level-driven bars; near-silence renders as a dotted line. */}
              <div className="flex h-12 items-center gap-1" aria-hidden>
                {Array.from({ length: BAR_COUNT }, (_, i) => (
                  <div
                    key={i}
                    ref={(el) => { barRefs.current[i] = el }}
                    className="h-full w-1 origin-center rounded-full bg-primary/70 transition-transform duration-75"
                    style={{ transform: "scaleY(0.12)" }}
                  />
                ))}
              </div>

              <p className="text-sm tabular-nums text-muted-foreground">
                {fmtClock(recorder.elapsed)} / {fmtClock(maxSeconds)}
              </p>

              <div className="flex items-center gap-4">
                <Button
                  variant="outline" size="icon" className="size-12 rounded-full"
                  aria-label={t("transactions:cancel")}
                  onClick={() => setOpen(false)}
                >
                  <X className="size-5" />
                </Button>
                <Button
                  size="icon" className="size-14 rounded-full"
                  aria-label={t("transactions:ai.stop")}
                  disabled={!recording}
                  onClick={recorder.stop}
                >
                  <Check className="size-6" />
                </Button>
              </div>

              <div className="flex flex-col items-center gap-1 text-center">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Sparkles className="size-4 text-primary" aria-hidden /> {t("aiVoice.note")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("aiVoice.creditsChip", { remaining: quota.remaining, cost })}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
