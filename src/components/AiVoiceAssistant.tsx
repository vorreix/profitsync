import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import {
  ArrowLeft, Check, CircleAlert, Crown, History, Loader as Loader2, Mic, Sparkles, Trash2, X,
} from "lucide-react"
import { apiErrorUpgradeHint } from "@/lib/api"
import {
  askAssistant, ASSISTANT_WAV_RATE, clearAiHistory, deleteAiAsk, fetchAiHistory, transcribePartial,
  type AiAskHistoryItem, type AiAssistantResponse, type AiQuota,
} from "@/lib/ai-parse"
import { createPcmTap, type PcmTap } from "@/lib/audio-wav"
import { useVoiceRecorder } from "@/hooks/use-voice-recorder"
import { canOpenAppSettings, openAppSettings } from "@/lib/native-shell"
import { useCurrency } from "@/lib/currency-context"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { AiAssistantConfirm } from "@/components/AiAssistantConfirm"
import { AiOrb } from "@/components/AiOrb"

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

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
 * Word-by-word live transcript: appended words materialize (transform/opacity
 * only — no filters, per the WebView compositing constraints that shaped this
 * overlay), corrections re-render in place without flashing (index-keyed
 * spans), and the text bottom-anchors inside a fixed-height clip so the
 * NEWEST words stay visible when a long dictation outgrows the slot
 * (line-clamp would hide the end of the text, not the start).
 */
function LiveTranscript({ text }: { text: string }) {
  const clipRef = useRef<HTMLDivElement | null>(null)
  const [clipped, setClipped] = useState(false)
  useEffect(() => {
    const el = clipRef.current
    if (!el) return
    setClipped(el.scrollHeight > el.clientHeight + 1)
    // Caption roll: the newest words stay visible by SCROLLING the clip (a
    // scroll offset is not a layout shift — bottom-anchoring with items-end
    // would jolt every prior line upward on each new line instead).
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [text])
  const words = text.split(/\s+/).filter(Boolean)
  return (
    <div
      ref={clipRef}
      className={`flex h-full w-full flex-col overflow-hidden ${clipped ? "ai-live-clip-fade" : ""}`}
    >
      {/* my-auto centers short transcripts and degrades to top-anchored
          scrollable once the text outgrows the fixed slot. NO text-balance:
          it re-breaks every line on each appended word — pure layout churn. */}
      <p className="my-auto w-full text-center text-base font-medium leading-7" aria-live="polite">
        {words.map((w, i) => (
          <Fragment key={i}>
            <span className="ai-live-word">{w}</span>{" "}
          </Fragment>
        ))}
        <span className="ai-live-caret" aria-hidden />
      </p>
    </div>
  )
}

/**
 * The floating AI voice assistant (mobile): tap → fullscreen overlay
 * that listens immediately with a LIVE transcript on every platform —
 * SpeechRecognition where the engine has it (Chrome/Safari), otherwise
 * server-side partials off the mic tap (the native WebViews; see
 * startServerPartials) — then shows a REVIEW CARD — "Creating outgoing
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
  // Mic-permission denials get a dedicated "Open settings" recovery on iOS,
  // where the OS never re-prompts once denied (see use-voice-recorder).
  const [errorDenied, setErrorDenied] = useState(false)
  const [confirmData, setConfirmData] = useState<AiAssistantResponse | null>(null)
  const [liveText, setLiveText] = useState("")
  const [history, setHistory] = useState<AiAskHistoryItem[] | null>(null)
  const [clearing, setClearing] = useState(false)
  const reqIdRef = useRef(0)

  // ── Live mic meter: AnalyserNode → RMS level → the orb's glow/scale ───────
  // The overlay orb reacts to the voice instead of a bar waveform: the level
  // drives `--ai-orb-level` imperatively (no re-renders at 20fps).
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef(0)
  const orbRef = useRef<HTMLDivElement | null>(null)
  // Raw-PCM tap on the same graph — feeds the server-side live transcript on
  // engines without SpeechRecognition (see startServerPartials below).
  const tapRef = useRef<PcmTap | null>(null)

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    tapRef.current?.close()
    tapRef.current = null
    void audioCtxRef.current?.close().catch(() => undefined)
    audioCtxRef.current = null
    orbRef.current?.style.setProperty("--ai-orb-level", "0")
  }, [])

  const startMeter = useCallback((stream: MediaStream) => {
    stopMeter()
    try {
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      const source = ctx.createMediaStreamSource(stream)
      source.connect(analyser)
      // Always tapped (bounded at 60 s, freed on stop): the SpeechRecognition
      // path can fail mid-flight and hand over to server partials.
      tapRef.current = createPcmTap(ctx, source, 60)
      const buf = new Uint8Array(analyser.fftSize)
      let last = 0
      let smoothed = 0
      const tick = (now: number) => {
        rafRef.current = requestAnimationFrame(tick)
        if (now - last < 50) return // ~20fps is plenty for a glow
        last = now
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128
          sum += v * v
        }
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 4)
        // fast attack, slow release — feels alive without flickering
        smoothed = level > smoothed ? level : smoothed * 0.86
        orbRef.current?.style.setProperty("--ai-orb-level", smoothed.toFixed(3))
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch {
      // The meter is decorative — recording works without it.
    }
  }, [stopMeter])

  // ── Live transcript tier 2: server partials ───────────────────────────────
  // The native WebViews have NO SpeechRecognition, so the mic tap's audio-
  // so-far is periodically transcribed by /api/ai/transcribe (free — the ask
  // itself pays; the endpoint verifies the caller could afford that ask).
  // A session-guarded setTimeout chain with adaptive cadence: quick first
  // feedback, then progressively slower ticks so a long dictation doesn't
  // hammer mobile data with ever-growing uploads. Display-only, like tier 1.
  const partialSessionRef = useRef(0)
  const stopServerPartials = useCallback(() => { partialSessionRef.current++ }, [])
  const startServerPartials = useCallback(() => {
    const session = ++partialSessionRef.current
    const startedAt = Date.now()
    const tick = async () => {
      if (partialSessionRef.current !== session) return
      if (recorderRef.current.state !== "recording") return // ended — stop rescheduling
      const wav = (await tapRef.current?.getWavBase64(ASSISTANT_WAV_RATE).catch(() => null)) ?? null
      if (partialSessionRef.current !== session) return
      // ~45 s of audio is the partials ceiling: the transcript so far stays
      // on screen and the final ask still hears the whole recording.
      if (wav && wav.length > 1_450_000) return
      if (wav) {
        try {
          const token = await getToken()
          if (token) {
            const text = await transcribePartial(token, { data: wav, media_type: "audio/wav" })
            if (partialSessionRef.current === session && text.trim()) setLiveText(text.trim())
          }
        } catch (err) {
          // 4xx (credits exhausted / throttled / misconfigured) → give up
          // quietly for this recording; network/5xx just waits for next tick.
          const status = (err as { status?: number }).status
          if (status != null && status < 500) return
        }
      }
      if (partialSessionRef.current !== session) return
      window.setTimeout(() => void tick(), Math.min(10_000, Math.max(4_000, (Date.now() - startedAt) / 4)))
    }
    window.setTimeout(() => void tick(), 2_500)
  }, [getToken])

  // ── Live transcript tier 1: SpeechRecognition (display-only) ──────────────
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
      let gotText = false
      rec.onresult = (e) => {
        gotText = true
        let interim = ""
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) finalText += r[0].transcript
          else interim += r[0].transcript
        }
        setLiveText((finalText + " " + interim).trim())
      }
      rec.onerror = () => {
        // Stubbed engines, mic contention, service failures: if recognition
        // produced nothing, hand over to server partials so the transcript
        // still appears. Deliberate stops clear onerror first. An error ends
        // the recognition session per spec, but stop() costs nothing and
        // guards engines that keep the session alive anyway.
        if (!gotText && speechRef.current === rec) {
          speechRef.current = null
          try { rec.stop() } catch { /* already ended */ }
          startServerPartials()
        }
      }
      rec.start()
      speechRef.current = rec
    } catch {
      speechRef.current = null
      startServerPartials()
    }
  }, [i18n.language, startServerPartials])
  const stopLiveTranscript = useCallback(() => {
    const rec = speechRef.current
    speechRef.current = null
    if (rec) {
      rec.onerror = null
      try { rec.stop() } catch { /* already stopped */ }
    }
  }, [])

  // One switch for both tiers — every stop site must kill BOTH (a leaked
  // partial loop would keep polling the transcribe endpoint).
  const startLiveFeedback = useCallback(() => {
    if (speechRecognitionCtor()) startLiveTranscript()
    else startServerPartials()
  }, [startLiveTranscript, startServerPartials])
  const stopLiveFeedback = useCallback(() => {
    stopLiveTranscript()
    stopServerPartials()
  }, [stopLiveTranscript, stopServerPartials])

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
    onFinish: (wav) => { stopLiveFeedback(); stopMeter(); void runAsk(wav) },
    onStream: startMeter,
    onError: (kind) => {
      stopLiveFeedback()
      stopMeter()
      setErrorMsg(kind === "denied" ? t("transactions:ai.micDenied") : t("aiVoice.failed"))
      setErrorDenied(kind === "denied")
      setPhase("error")
    },
  })
  const recorderRef = useRef(recorder)
  recorderRef.current = recorder

  const cost = quota?.costs.assistant ?? 20
  const exhausted = (quota?.remaining ?? 0) < cost

  const startListening = useCallback(() => {
    setErrorMsg("")
    setErrorDenied(false)
    setLiveText("")
    setPhase("listening")
    void recorderRef.current.start()
    startLiveFeedback()
  }, [startLiveFeedback])

  // Unmount safety: never leave the meter, recognizer or partial loop running.
  useEffect(() => () => { reqIdRef.current++; stopLiveFeedback(); stopMeter() }, [stopMeter, stopLiveFeedback])

  // Opening the overlay starts listening immediately (one tap to talk).
  useEffect(() => {
    if (!open) {
      reqIdRef.current++
      recorderRef.current.cancel()
      stopLiveFeedback()
      stopMeter()
      setConfirmData(null)
      return
    }
    if (!exhausted) startListening()
    else setPhase("listening")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function openHistory() {
    recorderRef.current.cancel()
    stopLiveFeedback()
    stopMeter()
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
      {/* Floating trigger, stacked just above the FAB: the energy orb itself,
          drifting very slowly. Its glow halo is part of the component. The
          w-14 wrapper matches the size-14 FAB below, so in the items-end
          stack the 44px orb sits exactly on the FAB's center axis. */}
      <div className="flex w-14 justify-center">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={t("aiVoice.openLabel")}
          onClick={() => setOpen(true)}
          className="group relative size-11 overflow-visible rounded-full p-0 hover:bg-transparent dark:hover:bg-transparent"
        >
          <AiOrb size={44} gold={free} className="transition-transform duration-150 group-active:scale-90 group-hover:scale-105" />
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* Opaque surface, NO backdrop-filter and NO filter:blur children: the
            WebView disables backdrop-blur (html.native-app), which used to
            leave a see-through /80 sheet, and fullscreen blur layers are what
            Chromium-on-Android intermittently mis-composites into dark bands.
            The glows below are plain radial gradients — same look, no filter. */}
        <DialogContent
          className="inset-0 top-0 left-0 flex h-full max-h-none w-full max-w-none sm:max-w-none translate-x-0 translate-y-0 flex-col items-center justify-center gap-0 overflow-y-auto rounded-none sm:rounded-none border-0 bg-background p-6 safe-pb"
        >
          <DialogTitle className="sr-only">{t("aiVoice.openLabel")}</DialogTitle>

          {/* Ambient light field — two static gradient glows give the overlay
              its cinematic depth in both themes (gold-tinted on free). */}
          <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
            <div className={`absolute -start-32 -top-32 size-[28rem] rounded-full ${free ? "bg-[radial-gradient(closest-side,rgb(245_158_11/0.12),transparent_75%)]" : "bg-[radial-gradient(closest-side,rgb(16_185_129/0.12),transparent_75%)]"}`} />
            <div className={`absolute -bottom-40 -end-32 size-[32rem] rounded-full ${free ? "bg-[radial-gradient(closest-side,rgb(234_179_8/0.12),transparent_75%)]" : "bg-[radial-gradient(closest-side,rgb(52_211_153/0.12),transparent_75%)]"}`} />
          </div>

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
            <div className="flex flex-col items-center gap-4 text-center animate-in fade-in zoom-in-95 duration-300 motion-reduce:animate-none">
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
            <div className="flex h-full w-full max-w-sm flex-col gap-3 py-8 animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none">
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
            <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-3 duration-300 motion-reduce:animate-none">
              <AiAssistantConfirm
                response={confirmData}
                currency={currency}
                onSaved={() => setOpen(false)}
                onEdit={() => { setOpen(false); onEdit(confirmData) }}
                onCancel={() => setOpen(false)}
              />
            </div>
          ) : phase === "error" ? (
            <div className="flex flex-col items-center gap-4 text-center animate-in fade-in zoom-in-95 duration-300 motion-reduce:animate-none" aria-live="polite">
              <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10 ring-8 ring-destructive/5">
                <CircleAlert className="size-8 text-destructive" aria-hidden />
              </div>
              <p className="max-w-[22rem] text-sm text-muted-foreground">{errorMsg}</p>
              {errorDenied && canOpenAppSettings() ? (
                /* iOS never re-prompts a denied mic permission — Settings is the
                   only recovery, so it gets the primary action. */
                <div className="flex flex-col items-center gap-2">
                  <Button className="rounded-full px-6" onClick={openAppSettings}>
                    {t("transactions:ai.micOpenSettings")}
                  </Button>
                  <Button variant="outline" className="rounded-full px-6" onClick={startListening}>
                    <Mic className="me-2 size-4" /> {t("aiVoice.tryAgain")}
                  </Button>
                </div>
              ) : (
                <Button className="rounded-full px-6" onClick={startListening}>
                  <Mic className="me-2 size-4" /> {t("aiVoice.tryAgain")}
                </Button>
              )}
            </div>
          ) : (
            /* ── Voice: the orb IS the interface — it breathes and glows with
                 the voice while listening, then swirls while thinking. One
                 persistent element, so the state change morphs seamlessly. ── */
            <div className="flex w-full max-w-sm flex-col items-center gap-7 animate-in fade-in zoom-in-95 duration-300 motion-reduce:animate-none">
              <AiOrb
                ref={orbRef}
                size={172}
                gold={free}
                mode={phase === "asking" ? "thinking" : "listening"}
              />

              {phase === "asking" ? (
                <div className="flex flex-col items-center gap-3 text-center" aria-live="polite">
                  <p className="ai-orb-status-shimmer text-sm font-medium">{t("aiVoice.thinking")}</p>
                  {liveText && (
                    <p className="line-clamp-2 max-w-[22rem] text-xs text-muted-foreground">“{liveText}”</p>
                  )}
                </div>
              ) : (
                <>
                  {/* Live transcript replaces the hint inside a FIXED-height
                      slot (3 lines) — nothing below ever moves while words
                      stream in; long dictations roll like captions. */}
                  <div className="flex h-[5.25rem] w-full items-center justify-center">
                    {liveText ? (
                      <LiveTranscript text={liveText} />
                    ) : (
                      <p className="flex items-center gap-1.5 text-center text-sm text-muted-foreground">
                        <Sparkles className={`size-4 ${free ? "text-amber-500 dark:text-amber-400" : "text-emerald-500 dark:text-emerald-400"}`} aria-hidden />
                        {t("aiVoice.note")}
                      </p>
                    )}
                  </div>

                  <p className="text-sm tabular-nums text-muted-foreground" aria-hidden={!recording}>
                    {fmtClock(recorder.elapsed)} / {fmtClock(maxSeconds)}
                  </p>

                  <div className="flex items-center gap-5">
                    <Button
                      variant="outline" size="icon"
                      className="size-12 rounded-full border-border/60 bg-muted/50 transition-transform active:scale-95"
                      aria-label={t("transactions:cancel")}
                      onClick={() => setOpen(false)}
                    >
                      <X className="size-5" />
                    </Button>
                    <Button
                      size="icon" className="size-14 rounded-full shadow-lg transition-transform active:scale-95"
                      aria-label={t("transactions:ai.stop")}
                      disabled={!recording}
                      onClick={recorder.stop}
                    >
                      <Check className="size-6" />
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {t("aiVoice.creditsChip", { remaining: quota.remaining, cost })}
                  </p>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
