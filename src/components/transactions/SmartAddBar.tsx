import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Camera, CircleAlert, Loader as Loader2, Sparkles, SendHorizontal, Undo2, X } from "lucide-react"
import { useAuth } from "@clerk/clerk-react"
import { apiErrorUpgradeHint } from "@/lib/api"
import { fetchAiQuota, parseWithAi, preprocessReceipt, type AiParseResponse } from "@/lib/ai-parse"
import { formatMoney } from "@/lib/wealth"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export type SmartApply = { response: AiParseResponse; receiptFile: File | null }

type BarState =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "applied"; response: AiParseResponse; filled: number; check: string[] }
  | { kind: "error"; message: string }

/**
 * The AI quick-add bar at the top of the Add-Transaction modal: type a
 * sentence or shoot a receipt → the form below prefills (review-before-save;
 * the AI never writes to the DB). Self-contained: quota fetch, camera capture
 * + preprocessing, parse call, ambiguity chips. Renders null while quota is
 * unknown or the feature is unconfigured, so the modal is byte-identical for
 * orgs without the feature (and for e2e, which runs without an API key).
 */
export function SmartAddBar({ currency, onApply, onUndo, onPickClient, onUpgrade }: {
  currency: string
  onApply: (a: SmartApply) => { filled: number; check: string[] }
  onUndo: () => void
  onPickClient: (id: string | null) => void
  onUpgrade: () => void
}) {
  const { t } = useTranslation("transactions")
  const { getToken } = useAuth()
  const [quota, setQuota] = useState<{ enabled: boolean; remaining: number; limit: number } | null>(null)
  const [text, setText] = useState("")
  const [state, setState] = useState<BarState>({ kind: "idle" })
  const [candidates, setCandidates] = useState<{ id: string; name: string }[] | null>(null)
  const [candidatesDone, setCandidatesDone] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const q = await fetchAiQuota(token)
        if (!cancelled) setQuota(q)
      } catch {
        // Quota probe failing = feature unavailable right now; stay hidden.
        if (!cancelled) setQuota({ enabled: false, remaining: 0, limit: 0 })
      }
    })()
    return () => { cancelled = true }
  }, [getToken])

  if (!quota?.enabled) return null
  const exhausted = quota.remaining <= 0

  async function runParse(input: { text?: string; image?: { data: string; media_type: string } }, receiptFile: File | null) {
    abortRef.current = false
    setState({ kind: "parsing" })
    setCandidates(null)
    setCandidatesDone(false)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const response = await parseWithAi(token, input)
      if (abortRef.current) return
      const { filled, check } = onApply({ response, receiptFile })
      setQuota((q) => (q ? { ...q, remaining: response.remaining } : q))
      setCandidates(response.client_candidates)
      setState({ kind: "applied", response, filled, check })
      setText("")
    } catch (err) {
      if (abortRef.current) return
      if (apiErrorUpgradeHint(err)) {
        setQuota((q) => (q ? { ...q, remaining: 0 } : q))
        setState({ kind: "idle" })
        return
      }
      const unparseable = err instanceof Error && err.message.includes("unparseable")
      setState({
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
      setState({ kind: "error", message: t("ai.errorGeneric") })
    }
  }

  const parsing = state.kind === "parsing"
  const canSend = text.trim().length > 0 && !parsing && !exhausted

  // Exhausted → the bar becomes the upsell (kept visible for discovery).
  if (exhausted && state.kind !== "applied") {
    return (
      <div className="flex min-h-11 items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
        <Sparkles className="size-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t("ai.quotaExhausted", { count: quota.limit })}</p>
        <Button size="sm" className="shrink-0" onClick={onUpgrade}>{t("ai.upgrade")}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className={`flex items-end gap-1.5 rounded-xl border bg-muted/40 p-2 ${parsing ? "ai-shimmer-border" : ""}`}>
        <Sparkles className="mb-2.5 ms-1 size-4 shrink-0 text-primary" aria-hidden />
        <Textarea
          value={text}
          onChange={(e) => { setText(e.target.value); if (state.kind === "error") setState({ kind: "idle" }) }}
          placeholder={t("ai.placeholder", { example: formatMoney(450, currency) })}
          rows={1}
          enterKeyHint="go"
          disabled={parsing}
          aria-label={t("ai.inputLabel")}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && canSend) {
              e.preventDefault()
              void runParse({ text: text.trim() }, null)
            }
          }}
          className="max-h-16 min-h-9 flex-1 resize-none border-0 bg-transparent p-1.5 text-base shadow-none focus-visible:ring-0 md:text-sm"
        />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onReceiptPick} />
        {parsing ? (
          <Button
            type="button" variant="ghost" size="icon" className="size-11 shrink-0"
            aria-label={t("cancel")}
            onClick={() => { abortRef.current = true; setState({ kind: "idle" }) }}
          >
            <X className="size-4" />
          </Button>
        ) : (
          <>
            <Button
              type="button" variant="ghost" size="icon" className="size-11 shrink-0 text-muted-foreground"
              aria-label={t("ai.cameraLabel")}
              onClick={() => cameraRef.current?.click()}
            >
              <Camera className="size-5" />
            </Button>
            {canSend && (
              <Button
                type="button" size="icon" className="size-11 shrink-0"
                aria-label={t("ai.parse")}
                onClick={() => void runParse({ text: text.trim() }, null)}
              >
                <SendHorizontal className="size-4 rtl:-scale-x-100" />
              </Button>
            )}
          </>
        )}
      </div>

      {/* Status strip — one polite live region covers parsing/applied/error. */}
      <div aria-live="polite">
        {parsing && (
          <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> {t("ai.parsing")}
          </p>
        )}
        {state.kind === "applied" && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
            <p className="text-xs text-muted-foreground">
              <Sparkles className="me-1 inline size-3 text-primary" aria-hidden />
              {t("ai.filledSummary", { count: state.filled })}
              {state.check.length > 0 && <span className="text-amber-600 dark:text-amber-400"> · {t("ai.checkFields", { fields: state.check.join(", ") })}</span>}
            </p>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { setState({ kind: "idle" }); setCandidates(null); onUndo() }}>
              <Undo2 className="me-1 size-3" /> {t("ai.undo")}
            </Button>
          </div>
        )}
        {state.kind === "error" && (
          <p className="flex items-center gap-1.5 px-1 text-xs text-destructive">
            <CircleAlert className="size-3 shrink-0" /> {state.message}
          </p>
        )}
        {quota.remaining > 0 && quota.remaining <= 5 && state.kind !== "applied" && !parsing && (
          <p className="px-1 text-xs text-muted-foreground">{t("ai.quotaLow", { count: quota.remaining })}</p>
        )}
      </div>

      {/* Ambiguous client match → explicit choice instead of a silent guess. */}
      {candidates && candidates.length > 0 && !candidatesDone && (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          <span className="text-xs text-muted-foreground">{t("ai.didYouMean")}</span>
          {candidates.map((c) => (
            <Button
              key={c.id} variant="outline" size="sm" className="h-8 max-w-[12rem] px-2.5 text-xs"
              onClick={() => { onPickClient(c.id); setCandidatesDone(true) }}
            >
              <span className="truncate">{c.name}</span>
            </Button>
          ))}
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground" onClick={() => { onPickClient(null); setCandidatesDone(true) }}>
            {t("ai.none")}
          </Button>
        </div>
      )}
    </div>
  )
}
