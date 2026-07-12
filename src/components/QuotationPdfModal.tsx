import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Download, ExternalLink, FileText, Loader as Loader2, RotateCw, Share2, TriangleAlert } from "lucide-react"
import { getActiveOrgId } from "@/lib/api"
import type { Quotation } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

// The single endpoint this modal talks to returns three shapes by HTTP status:
//   200 → ready (fresh presigned view + download URLs, valid ~1h)
//   202 → generating (job enqueued / still rendering — poll)
//   503 → unavailable (S3 or worker not configured)
// We use a raw fetch (not apiGet) on purpose: apiGet caches GETs for 30s, which
// would freeze the poll, and it throws on the 503 we want to render as a state.
type PdfReady = {
  status: "ready"
  view_url: string
  download_url: string
  filename: string
  expires_in: number
  generated_at: string | null
  size_bytes: number
}
type PdfResponse =
  | PdfReady
  | { status: "generating"; queued?: boolean }
  | { status: "unavailable"; error?: string }

type Phase = "loading" | "generating" | "ready" | "unavailable" | "error"

const POLL_MS = 2000
const MAX_POLLS = 45 // ~90s ceiling before we surface a retry

export function QuotationPdfModal({ quotation, onClose }: { quotation: Quotation | null; onClose: () => void }) {
  const { t } = useTranslation("quotations")
  const { getToken } = useAuth()
  const [phase, setPhase] = useState<Phase>("loading")
  const [ready, setReady] = useState<PdfReady | null>(null)
  const [errorMsg, setErrorMsg] = useState("")
  const [retryNonce, setRetryNonce] = useState(0)

  const open = quotation !== null
  const quotationId = quotation?.id ?? null
  const title = quotation?.title ?? ""

  const fetchPdf = useCallback(
    async (id: string): Promise<PdfResponse> => {
      const token = await getToken()
      if (!token) throw new Error("auth")
      const orgId = getActiveOrgId()
      const res = await fetch(`/api/quotations/${id}/pdf`, {
        headers: { Authorization: `Bearer ${token}`, ...(orgId ? { "x-org-id": orgId } : {}) },
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (res.status === 200 && body.status === "ready") return body as unknown as PdfReady
      if (res.status === 202 || body.status === "generating") return { status: "generating" }
      if (res.status === 503 || body.status === "unavailable") {
        return { status: "unavailable", error: typeof body.error === "string" ? body.error : undefined }
      }
      throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`)
    },
    [getToken],
  )

  // Drive the state machine: fetch on open, then poll every POLL_MS while the
  // worker renders. Cancels cleanly on close / quotation change / retry.
  useEffect(() => {
    if (!open || !quotationId) return
    let cancelled = false
    let polls = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    async function tick() {
      polls += 1
      let result: PdfResponse
      try {
        result = await fetchPdf(quotationId as string)
      } catch (err) {
        if (cancelled) return
        setPhase("error")
        setErrorMsg(err instanceof Error && err.message !== "auth" ? err.message : t("pdf.errorTitle"))
        return
      }
      if (cancelled) return
      if (result.status === "ready") {
        setReady(result)
        setPhase("ready")
        return
      }
      if (result.status === "unavailable") {
        setPhase("unavailable")
        return
      }
      setPhase("generating")
      if (polls >= MAX_POLLS) {
        setPhase("error")
        setErrorMsg(t("pdf.timeout"))
        return
      }
      timer = setTimeout(tick, POLL_MS)
    }

    setPhase("loading")
    setReady(null)
    setErrorMsg("")
    tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [open, quotationId, retryNonce, fetchPdf, t])

  function handleView() {
    if (!ready) return
    const w = window.open(ready.view_url, "_blank", "noopener,noreferrer")
    if (!w) toast.error(t("pdf.openError"))
  }

  function handleDownload() {
    if (!ready) return
    // The presigned download URL carries `Content-Disposition: attachment`, so a
    // plain anchor click downloads it without navigating the SPA away.
    const a = document.createElement("a")
    a.href = ready.download_url
    a.rel = "noopener"
    a.download = ready.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function handleShare() {
    if (!ready) return
    const shareData = { title: ready.filename, text: t("pdf.shareText", { title }), url: ready.view_url }
    // navigator.share must be reached synchronously from the click gesture; the
    // URL is already in state so there's no await before the call.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData)
      } catch {
        // user dismissed the share sheet — not an error
      }
      return
    }
    try {
      await navigator.clipboard.writeText(ready.view_url)
      toast.success(t("pdf.linkCopied"))
    } catch {
      toast.error(t("pdf.openError"))
    }
  }

  function retry() {
    setRetryNonce((n) => n + 1)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="w-[92vw] max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-4 shrink-0" />
            <span className="truncate">{t("pdf.title")}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Generating / loading */}
        {(phase === "loading" || phase === "generating") && (
          <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-8 text-center">
            <Loader2 className="size-8 animate-spin text-primary motion-reduce:animate-none" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("pdf.generatingTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("pdf.generatingHint")}</p>
            </div>
          </div>
        )}

        {/* Ready — one primary CTA (View), Download + Share subordinate */}
        {phase === "ready" && ready && (
          <div className="space-y-4 py-2">
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground text-center">
              {t("pdf.ready")}
            </p>
            <div className="space-y-2">
              <Button className="w-full h-11" onClick={handleView}>
                <ExternalLink className="size-4" />
                {t("pdf.view")}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="h-11" onClick={handleDownload}>
                  <Download className="size-4" />
                  {t("pdf.download")}
                </Button>
                <Button variant="outline" className="h-11" onClick={handleShare}>
                  <Share2 className="size-4" />
                  {t("pdf.share")}
                </Button>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground text-center">{t("pdf.expiresNote")}</p>
          </div>
        )}

        {/* Unavailable (storage/worker not configured) */}
        {phase === "unavailable" && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <TriangleAlert className="size-8 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("pdf.unavailableTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("pdf.unavailableHint")}</p>
            </div>
          </div>
        )}

        {/* Error — with a recovery path */}
        {phase === "error" && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <TriangleAlert className="size-8 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("pdf.errorTitle")}</p>
              <p className="text-xs text-muted-foreground break-words">{errorMsg}</p>
            </div>
            <Button variant="outline" className="h-11" onClick={retry}>
              <RotateCw className="size-4" />
              {t("pdf.retry")}
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t("pdf.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
