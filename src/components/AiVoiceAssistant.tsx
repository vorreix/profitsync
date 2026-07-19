import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import {
  ArrowLeft, Check, CircleAlert, Crown, History, Loader as Loader2, Mic, Sparkles, Trash2, X,
} from "lucide-react"
import { apiErrorUpgradeHint } from "@/lib/api"
import {
  askAssistant, ASSISTANT_WAV_RATE, clearAiHistory, deleteAiAsk, fetchAiHistory,
  type AiAskHistoryItem, type AiAssistantResponse, type AiQuota,
} from "@/lib/ai-parse"
import { useVoiceRecorder } from "@/hooks/use-voice-recorder"
import { useCurrency } from "@/lib/currency-context"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { AiAssistantConfirm } from "@/components/AiAssistantConfirm"

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

const BAR_COUNT = 27

// Minimal SpeechRecognition surface (lib.dom lacks it; WebViews lack the API
// entirely — it is a PROGRESSIVE enhancement for live-transcript display only,
// the server always transcribes from the audio itself).
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}
// SpeechRecognition wants full BCP-47 locales; the app stores short codes.
const SPEECH_LOCALE: Record<string, string> = {
  en: "en-US", it: "it-IT", de: "de-DE", hi: "hi-IN", ml: "ml-IN", ta: "ta-IN", te: "te-IN", ar: "ar-SA",
}

const speechRecognitionCtor = (): (new () => SpeechRecognitionLike) | null => {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null
}

type Phase = "listening" | "asking" | "confirm" | "history" | "error"

/**
 * The floating AI voice assistant (mobile): tap → blurred fullscreen overlay
 * that listens immediately (live waveform + live transcript where the engine
 * supports SpeechRecognition), then shows a REVIEW CARD — "Creating outgoing
 * transaction of €20.00", the transcript, resolved fields, pickers only for
 * gaps — whose Save creates the record directly. show_transactions navigates
 * with filters applied; Edit hands off to the full prefilled dialog. A
 * deletable ask-history is kept for the USER only (never fed to the model).
 */
export function AiVoiceAssistant({ quota, onEdit, onQuotaUsed }: {
  quota: AiQuota | null
  onEdit: (r: AiAssistantResponse) => void
  onQuotaUsed: (remaining: number) => void
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>("listening")
  const [errorMsg, setErrorMsg] = useState("")
  const [confirmData, setConfirmData] = useState<AiAssistantResponse | null>(null)
  const [liveText, setLiveText] = useState("")
  const [history, setHistory] = useState<AiAskHistoryItem[] | null>(null)
  const [clearing, setClearing] = useState(false)
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
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 4)
        const levels = levelsRef.current
        levels.push(level)
        levels.shift()
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

  // ── Live transcript (progressive enhancement; display-only) ───────────────
  const speechRef = useRef<SpeechRecognitionLike | null>(null)
  const startLiveTranscript = useCallback(() => {
    const Ctor = speechRecognitionCtor()
    if (!Ctor) return
    try {
      const rec = new Ctor()
      rec.lang = SPEECH_LOCALE[i18n.language.split("-")[0]] ?? i18n.language
      rec.interimResults = true
      rec.continuous = true
      let finalText = ""
      rec.onresult = (e) => {
        let interim = ""
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) finalText += r[0].transcript
          else interim += r[0].transcript
        }
        setLiveText((finalText + " " + interim).trim())
      }
      rec.onerror = () => undefined // display-only; the server transcribes anyway
      rec.start()
      speechRef.current = rec
    } catch {
      speechRef.current = null
    }
  }, [i18n.language])
  const stopLiveTranscript = useCallback(() => {
    try { speechRef.current?.stop() } catch { /* already stopped */ }
    speechRef.current = null
  }, [])

  const runAsk = useCallback(async (wavBase64: string) => {
    const reqId = ++reqIdRef.current
    setPhase("asking")
    try {
      const token = await getToken()
      if (!token) throw new Error("not authenticated")
      const response = await askAssistant(token, { audio: { data: wavBase64, media_type: "audio/wav" } })
      if (reqIdRef.current !== reqId) return
      onQuotaUsed(response.remaining)
      if (response.intent === "show_transactions" && response.search) {
        // Navigation intent: apply the filters and go — no card needed.
        toast.success(response.say ?? t("aiVoice.showingTransactions"))
        setOpen(false)
        if (response.search.client_id) {
          navigate(`/clients/${response.search.client_id}`)
        } else {
          const params = new URLSearchParams()
          if (response.search.from) params.set("from", response.search.from)
          if (response.search.to) params.set("to", response.search.to)
          if (response.search.category) params.set("category", response.search.category)
          navigate(`/transactions${params.size ? `?${params}` : ""}`)
        }
        return
      }
      if (response.intent === "unknown") {
        setErrorMsg(response.say ?? t("aiVoice.cantHelp"))
        setPhase("error")
        return
      }
      setConfirmData(response)
      setPhase("confirm")
    } catch (err) {
      if (reqIdRef.current !== reqId) return
      if (apiErrorUpgradeHint(err)) {
        setErrorMsg(t("transactions:ai.notEnoughCredits"))
        setPhase("error")
        return
      }
      const unparseable = err instanceof Error && err.message.includes("unparseable")
      setErrorMsg(unparseable ? t("aiVoice.notUnderstood") : t("aiVoice.failed"))
      setPhase("error")
    }
  }, [getToken, onQuotaUsed, navigate, t])

  const maxSeconds = quota?.assistant_max_record_seconds || 30
  const recorder = useVoiceRecorder({
    maxSeconds,
    sampleRate: ASSISTANT_WAV_RATE,
    onFinish: (wav) => { stopMeter(); stopLiveTranscript(); void runAsk(wav) },
    onStream: startMeter,
    onError: (kind) => {
      stopMeter()
      stopLiveTranscript()
      setErrorMsg(kind === "denied" ? t("transactions:ai.micDenied") : t("aiVoice.failed"))
      setPhase("error")
    },
  })
  const recorderRef = useRef(recorder)
  recorderRef.current = recorder

  const cost = quota?.costs.assistant ?? 20
  const exhausted = (quota?.remaining ?? 0) < cost

  const startListening = useCallback(() => {
    setErrorMsg("")
    setLiveText("")
    setPhase("listening")
    levelsRef.current = Array.from({ length: BAR_COUNT }, () => 0)
    void recorderRef.current.start()
    startLiveTranscript()
  }, [startLiveTranscript])

  // Unmount safety: never leave the meter or recognizer running.
  useEffect(() => () => { reqIdRef.current++; stopMeter(); stopLiveTranscript() }, [stopMeter, stopLiveTranscript])

  // Opening the overlay starts listening immediately (one tap to talk).
  useEffect(() => {
    if (!open) {
      reqIdRef.current++
      recorderRef.current.cancel()
      stopMeter()
      stopLiveTranscript()
      setConfirmData(null)
      return
    }
    if (!exhausted) startListening()
    else setPhase("listening")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function openHistory() {
    recorderRef.current.cancel()
    stopMeter()
    stopLiveTranscript()
    setPhase("history")
    setHistory(null)
    try {
      const token = await getToken()
      if (token) setHistory(await fetchAiHistory(token))
    } catch {
      toast.error(t("aiVoice.failed"))
      setHistory([])
    }
  }

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
          className="inset-0 top-0 left-0 flex h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col items-center justify-center gap-0 overflow-y-auto rounded-none border-0 bg-background/70 p-6 backdrop-blur-xl safe-pb"
        >
          <DialogTitle className="sr-only">{t("aiVoice.openLabel")}</DialogTitle>

          {/* History entry point (listening view only, opposite the close ✕) */}
          {phase === "listening" && !exhausted && (
            <Button
              variant="ghost" size="icon"
              className="absolute start-3 top-3 size-11 text-muted-foreground"
              aria-label={t("aiVoice.historyTitle")}
              onClick={() => void openHistory()}
            >
              <History className="size-5" />
            </Button>
          )}

          {exhausted && phase !== "history" ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-amber-500/15">
                <Crown className="size-8 text-amber-500 dark:text-amber-400" aria-hidden />
              </div>
              <p className="max-w-[22rem] text-sm text-muted-foreground">{t("transactions:ai.quotaExhausted")}</p>
              <Button onClick={() => { setOpen(false); navigate("/subscription") }}>
                <Crown className="me-2 size-4" /> {t("transactions:ai.upgrade")}
              </Button>
            </div>
          ) : phase === "history" ? (
            /* ── Ask history: the user's log; never fed back to the model ── */
            <div className="flex h-full w-full max-w-sm flex-col gap-3 py-8">
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="-ms-2 size-9" aria-label={t("transactions:cancel")} onClick={startListening}>
                  <ArrowLeft className="size-4 rtl:-scale-x-100" />
                </Button>
                <p className="flex-1 text-sm font-medium">{t("aiVoice.historyTitle")}</p>
                {history != null && history.length > 0 && (
                  <Button
                    variant="ghost" size="sm" className="h-11 text-xs text-muted-foreground"
                    disabled={clearing}
                    onClick={async () => {
                      setClearing(true)
                      try {
                        const token = await getToken()
                        if (token) { await clearAiHistory(token); setHistory([]) }
                      } catch {
                        toast.error(t("aiVoice.failed"))
                      } finally {
                        setClearing(false)
                      }
                    }}
                  >
                    {clearing ? <Loader2 className="me-1 size-3 animate-spin motion-reduce:animate-none" /> : null}
                    {t("aiVoice.clearHistory")}
                  </Button>
                )}
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto scrollbar-thin" aria-live="polite">
                {history == null ? (
                  <p className="flex items-center justify-center gap-1.5 py-8 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin motion-reduce:animate-none" /> {t("aiVoice.thinking")}
                  </p>
                ) : history.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">{t("aiVoice.historyEmpty")}</p>
                ) : (
                  history.map((item) => (
                    <div key={item.id} className="flex items-start gap-2 rounded-xl border bg-background/60 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm">{item.transcript || item.say || "—"}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {new Date(item.created_at).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                      </div>
                      <Button
                        variant="ghost" size="icon" className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={t("aiVoice.deleteAsk")}
                        onClick={async () => {
                          // No optimistic removal — the row disappears only
                          // once the server really deleted it.
                          try {
                            const token = await getToken()
                            if (!token) return
                            await deleteAiAsk(token, item.id)
                            setHistory((h) => h?.filter((x) => x.id !== item.id) ?? h)
                          } catch {
                            toast.error(t("aiVoice.failed"))
                          }
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : phase === "confirm" && confirmData ? (
            <AiAssistantConfirm
              response={confirmData}
              currency={currency}
              onSaved={() => setOpen(false)}
              onEdit={() => { setOpen(false); onEdit(confirmData) }}
              onCancel={() => setOpen(false)}
            />
          ) : phase === "error" ? (
            <div className="flex flex-col items-center gap-4 text-center" aria-live="polite">
              <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10">
                <CircleAlert className="size-8 text-destructive" aria-hidden />
              </div>
              <p className="max-w-[22rem] text-sm text-muted-foreground">{errorMsg}</p>
              <Button onClick={startListening}>
                <Mic className="me-2 size-4" /> {t("aiVoice.tryAgain")}
              </Button>
            </div>
          ) : phase === "asking" ? (
            <div className="flex flex-col items-center gap-4 text-center" aria-live="polite">
              <div className="flex size-20 items-center justify-center rounded-full bg-primary/10">
                <Loader2 className="size-8 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
              </div>
              <p className="text-sm font-medium">{t("aiVoice.thinking")}</p>
              {liveText && (
                <p className="line-clamp-2 max-w-[22rem] text-xs text-muted-foreground">“{liveText}”</p>
              )}
            </div>
          ) : (
            /* ── Listening: mic + live transcript + waveform + controls ──── */
            <div className="flex w-full max-w-sm flex-col items-center gap-6">
              <div className="relative flex size-20 items-center justify-center rounded-full bg-primary/10">
                {recording && (
                  <span className="absolute inset-0 animate-ping rounded-full bg-primary/20 motion-reduce:hidden" aria-hidden />
                )}
                <Mic className="size-9 text-primary" aria-hidden />
              </div>

              {/* Live transcript where the engine supports it (else nothing). */}
              {liveText && (
                <p className="line-clamp-2 w-full text-center text-sm leading-6" aria-live="polite">
                  {liveText}
                </p>
              )}

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
