import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Download, ExternalLink, FileText, Loader as Loader2, RotateCw, Share2, Sparkles, TriangleAlert } from "lucide-react"
import { getActiveOrgId } from "@/lib/api"
import { downloadPdf, viewPdf } from "@/lib/pdf-open"
import type { Quotation } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

// The GET is read-only: it returns the PDF *history* and never enqueues a render.
// Generation happens only when the user clicks Generate/Regenerate (POST). We use
// a raw fetch (not apiGet) so the poll isn't frozen by the 30s GET cache.
type PdfHistoryItem = {
  id: string
  generated_at: string | null
  size_bytes: number
  is_current: boolean
  view_url: string
  download_url: string
}
type PdfState = {
  filename: string
  unavailable: boolean
  can_generate: boolean
  generating: boolean
  latest_stale: boolean
  history: PdfHistoryItem[]
}

const POLL_MS = 2000
const MAX_POLLS = 45 // ~90s ceiling

function formatWhen(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}
function formatSize(bytes: number): string {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function QuotationPdfModal({ quotation, onClose }: { quotation: Quotation | null; onClose: () => void }) {
  const { t } = useTranslation("quotations")
  const { getToken } = useAuth()
  const [data, setData] = useState<PdfState | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false) // a generate/regenerate is in flight or polling
  const [errorMsg, setErrorMsg] = useState("")
  const pollRef = useRef<{ cancelled: boolean } | null>(null)

  const open = quotation !== null
  const quotationId = quotation?.id ?? null
  const title = quotation?.title ?? ""

  const authHeaders = useCallback(async (): Promise<Record<string, string> | null> => {
    const token = await getToken()
    if (!token) return null
    const orgId = getActiveOrgId()
    return { Authorization: `Bearer ${token}`, ...(orgId ? { "x-org-id": orgId } : {}) }
  }, [getToken])

  const fetchState = useCallback(async (): Promise<PdfState> => {
    const headers = await authHeaders()
    if (!headers) throw new Error("auth")
    const res = await fetch(`/api/quotations/${quotationId}/pdf`, { headers })
    const body = (await res.json().catch(() => ({}))) as Partial<PdfState> & { error?: string }
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return {
      filename: body.filename ?? "quotation.pdf",
      unavailable: !!body.unavailable,
      can_generate: !!body.can_generate,
      generating: !!body.generating,
      latest_stale: body.latest_stale !== false,
      history: Array.isArray(body.history) ? body.history : [],
    }
  }, [authHeaders, quotationId])

  // Poll while a generation is in flight; stops as soon as `generating` clears.
  const startPolling = useCallback(() => {
    if (pollRef.current) pollRef.current.cancelled = true
    const ctl = { cancelled: false }
    pollRef.current = ctl
    let polls = 0
    const tick = async () => {
      let next: PdfState
      try {
        next = await fetchState()
      } catch (err) {
        if (ctl.cancelled) return
        setWorking(false)
        setErrorMsg(err instanceof Error && err.message !== "auth" ? err.message : t("pdf.errorTitle"))
        return
      }
      if (ctl.cancelled) return
      setData(next)
      if (next.generating && polls < MAX_POLLS) {
        polls += 1
        setTimeout(tick, POLL_MS)
      } else {
        setWorking(false)
        if (next.generating) setErrorMsg(t("pdf.timeout"))
      }
    }
    setWorking(true)
    setTimeout(tick, POLL_MS)
  }, [fetchState, t])

  // On open (or quotation change): load the history once, then poll if a
  // generation is already in flight. NEVER triggers a render itself.
  useEffect(() => {
    if (!open || !quotationId) return
    const ctl = { cancelled: false }
    pollRef.current = ctl
    setLoading(true)
    setData(null)
    setErrorMsg("")
    setWorking(false)
    ;(async () => {
      let first: PdfState
      try {
        first = await fetchState()
      } catch (err) {
        if (ctl.cancelled) return
        setLoading(false)
        setErrorMsg(err instanceof Error && err.message !== "auth" ? err.message : t("pdf.errorTitle"))
        return
      }
      if (ctl.cancelled) return
      setData(first)
      setLoading(false)
      if (first.generating) startPolling()
    })()
    return () => {
      ctl.cancelled = true
      if (pollRef.current === ctl) pollRef.current = null
    }
  }, [open, quotationId, fetchState, startPolling, t])

  async function generate() {
    if (!quotationId) return
    setWorking(true)
    setErrorMsg("")
    try {
      const headers = await authHeaders()
      if (!headers) return
      const res = await fetch(`/api/quotations/${quotationId}/pdf`, { method: "POST", headers })
      if (res.status !== 202) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setWorking(false)
        setErrorMsg(body.error || t("pdf.generateError"))
        return
      }
      startPolling()
    } catch {
      setWorking(false)
      setErrorMsg(t("pdf.generateError"))
    }
  }

  function handleView(item: PdfHistoryItem) {
    void viewPdf(item).then((ok) => {
      if (!ok) toast.error(t("pdf.openError"))
    })
  }

  function handleDownload(item: PdfHistoryItem, filename: string) {
    if (!quotationId) return
    void downloadPdf({
      quotationId,
      generationId: item.id,
      urls: item,
      filename,
      getAuthHeaders: authHeaders,
    }).then((ok) => {
      if (!ok) toast.error(t("pdf.openError"))
    })
  }

  async function handleShare(url: string, filename: string) {
    const shareData = { title: filename, text: t("pdf.shareText", { title }), url }
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData)
      } catch {
        /* dismissed */
      }
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t("pdf.linkCopied"))
    } catch {
      toast.error(t("pdf.openError"))
    }
  }

  const filename = data?.filename ?? "quotation.pdf"
  const history = data?.history ?? []
  const latest = history[0]
  const rest = history.slice(1)

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="w-[92vw] max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-4 shrink-0" />
            <span className="truncate">{t("pdf.title")}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Initial load */}
        {loading && (
          <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-8 text-center">
            <Loader2 className="size-8 animate-spin text-primary motion-reduce:animate-none" />
          </div>
        )}

        {/* Hard error (fetch/generate) — recoverable */}
        {!loading && errorMsg && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <TriangleAlert className="size-8 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("pdf.errorTitle")}</p>
              <p className="text-xs text-muted-foreground break-words">{errorMsg}</p>
            </div>
            <Button variant="outline" className="h-11" onClick={() => { setErrorMsg(""); if (data?.can_generate) generate() }}>
              <RotateCw className="size-4" />
              {t("pdf.retry")}
            </Button>
          </div>
        )}

        {/* Storage/worker not configured */}
        {!loading && !errorMsg && data?.unavailable && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <TriangleAlert className="size-8 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("pdf.unavailableTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("pdf.unavailableHint")}</p>
            </div>
          </div>
        )}

        {/* Loaded, available */}
        {!loading && !errorMsg && data && !data.unavailable && (
          <div className="space-y-4 py-1">
            {/* Empty: no PDF yet → explicit Generate */}
            {history.length === 0 && !working && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <FileText className="size-8 text-muted-foreground/60" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">{t("pdf.emptyTitle")}</p>
                  <p className="text-xs text-muted-foreground">{t("pdf.emptyHint")}</p>
                </div>
                {data.can_generate && (
                  <Button className="h-11 w-full" onClick={generate}>
                    <Sparkles className="size-4" />
                    {t("pdf.generate")}
                  </Button>
                )}
              </div>
            )}

            {/* Generating a (first or new) version */}
            {working && (
              <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
                <Loader2 className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{history.length ? t("pdf.newVersionGenerating") : t("pdf.generatingTitle")}</p>
                  <p className="text-xs text-muted-foreground">{t("pdf.generatingHint")}</p>
                </div>
              </div>
            )}

            {/* Latest PDF — the prominent, actionable one */}
            {latest && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">{t("pdf.latestLabel")}</p>
                  {latest.is_current ? (
                    <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-300">{t("pdf.currentBadge")}</Badge>
                  ) : null}
                </div>
                <Button className="w-full h-11" onClick={() => handleView(latest)}>
                  <ExternalLink className="size-4" />
                  {t("pdf.view")}
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" className="h-11" onClick={() => handleDownload(latest, filename)}>
                    <Download className="size-4" />
                    {t("pdf.download")}
                  </Button>
                  <Button variant="outline" className="h-11" onClick={() => handleShare(latest.view_url, filename)}>
                    <Share2 className="size-4" />
                    {t("pdf.share")}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">{formatWhen(latest.generated_at)}{latest.size_bytes ? ` · ${formatSize(latest.size_bytes)}` : ""}</p>
              </div>
            )}

            {/* Stale hint + Regenerate */}
            {latest && data.can_generate && (
              <div className="space-y-2">
                {data.latest_stale && !working && (
                  <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">{t("pdf.staleHint")}</p>
                )}
                <Button variant="outline" className="w-full h-11" onClick={generate} disabled={working}>
                  <RotateCw className="size-4" />
                  {t("pdf.regenerate")}
                </Button>
              </div>
            )}

            {/* Previous versions (up to 5 total) */}
            {rest.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground pt-1">{t("pdf.historyTitle")}</p>
                <ul className="space-y-1.5">
                  {rest.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{formatWhen(item.generated_at) || t("pdf.title")}</p>
                        {item.size_bytes ? <p className="text-[10px] text-muted-foreground">{formatSize(item.size_bytes)}</p> : null}
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <Button size="icon" variant="ghost" className="size-8" aria-label={t("pdf.view")} title={t("pdf.view")} onClick={() => handleView(item)}>
                          <ExternalLink className="size-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-8" aria-label={t("pdf.download")} title={t("pdf.download")} onClick={() => handleDownload(item, filename)}>
                          <Download className="size-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-8" aria-label={t("pdf.share")} title={t("pdf.share")} onClick={() => handleShare(item.view_url, filename)}>
                          <Share2 className="size-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {latest && <p className="text-[11px] leading-relaxed text-muted-foreground">{t("pdf.expiresNote")}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t("pdf.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
