import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import {
  ArrowLeft,
  Download,
  Trash2,
  FileText,
  ExternalLink,
  Loader,
  Upload,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { ExpandableSearch } from "@/components/ExpandableSearch"
import { AttachmentDetailModal, type AttachmentModalItem } from "@/components/AttachmentDetailModal"
import type { Client } from "@/lib/types"
import { useOrg } from "@/lib/org-context"
import { apiGet, clearApiCache } from "@/lib/api"
import {
  ACCEPT_ATTR,
  attachmentItemPath,
  attachmentsListPath,
  uploadAttachment,
  validateFile,
  type AttachmentParent,
} from "@/lib/attachments-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type MediaItem = {
  id: string
  source: AttachmentParent
  source_id: string
  source_label: string
  file_name: string
  file_type: string
  file_size: number
  created_at: string
  display_name?: string | null
  tags?: string[]
  category?: string
}

const PAGE_SIZE = 12

const SOURCE_BADGE: Record<AttachmentParent, { label: string; className: string }> = {
  client: { label: "Document", className: "bg-muted text-foreground/70" },
  transaction: { label: "Transaction", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  quotation: { label: "Quote", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot >= 0 ? name.slice(dot + 1).toUpperCase() : "FILE"
}
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
function formatDate(s: string): string {
  const d = new Date(s)
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function ClientFilesPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const role = activeOrg?.role
  const canModify = role === "owner" || role === "admin" || role === "editor"
  const canRemove = role === "owner" || role === "admin"

  const [client, setClient] = useState<Client | null>(null)
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [query, setQuery] = useState("")
  const [sourceFilter, setSourceFilter] = useState<"all" | AttachmentParent>("all")
  const [sort, setSort] = useState("newest")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [page, setPage] = useState(1)
  const [deleteItem, setDeleteItem] = useState<MediaItem | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [modalItem, setModalItem] = useState<MediaItem | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Open the detail modal and reflect it in the URL so the view is shareable.
  function openModal(item: MediaItem) {
    setModalItem(item)
    const next = new URLSearchParams(searchParams)
    next.set("file", item.id)
    setSearchParams(next, { replace: true })
  }

  function closeModal() {
    setModalItem(null)
    const next = new URLSearchParams(searchParams)
    next.delete("file")
    setSearchParams(next, { replace: true })
  }

  const load = useCallback(async () => {
    if (!id) return
    try {
      const token = await getToken()
      if (!token) return
      const [c, media] = await Promise.all([
        apiGet<Client>(`/api/clients/${id}`, token),
        apiGet<MediaItem[]>(`/api/clients/${id}/media`, token),
      ])
      if (!c) { navigate("/clients"); return }
      setClient(c)
      setItems(media)
    } catch {
      toast.error("Failed to load files")
    } finally {
      setLoading(false)
    }
  }, [id, getToken, navigate])

  useEffect(() => { load() }, [load])

  // Deep link: ?file=<id> opens that attachment's modal once the list is loaded
  // (so a pasted URL reopens the same view).
  useEffect(() => {
    const fileId = searchParams.get("file")
    if (!fileId) { setModalItem(null); return }
    if (modalItem?.id === fileId) return
    const found = items.find((i) => i.id === fileId)
    if (found) setModalItem(found)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, items])

  const filtered = useMemo(() => {
    let list = items
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((i) => i.file_name.toLowerCase().includes(q) || i.source_label.toLowerCase().includes(q))
    if (sourceFilter !== "all") list = list.filter((i) => i.source === sourceFilter)
    if (from) {
      const f = new Date(from).getTime()
      list = list.filter((i) => new Date(i.created_at).getTime() >= f)
    }
    if (to) {
      const t = new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1
      list = list.filter((i) => new Date(i.created_at).getTime() <= t)
    }
    const sorted = [...list]
    sorted.sort((a, b) => {
      if (sort === "name") return a.file_name.localeCompare(b.file_name)
      if (sort === "largest") return b.file_size - a.file_size
      const ta = new Date(a.created_at).getTime()
      const tb = new Date(b.created_at).getTime()
      return sort === "oldest" ? ta - tb : tb - ta
    })
    return sorted
  }, [items, query, sourceFilter, sort, from, to])

  // Reset to the first page whenever the filtered set changes shape.
  useEffect(() => { setPage(1) }, [query, sourceFilter, sort, from, to])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  async function onUploadSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (fileRef.current) fileRef.current.value = ""
    if (files.length === 0 || !id) return
    const token = await getToken()
    if (!token) { toast.error("Not authenticated"); return }
    setUploading(true)
    let uploaded = 0
    for (const file of files) {
      const err = validateFile(file)
      if (err) { toast.error(err); continue }
      try {
        await uploadAttachment(attachmentsListPath("client", id), file, token)
        uploaded++
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed")
      }
    }
    if (uploaded > 0) {
      clearApiCache()
      toast.success(uploaded === 1 ? "File attached" : `${uploaded} files attached`)
      await load()
    }
    setUploading(false)
  }

  async function download(item: MediaItem) {
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch(attachmentItemPath(item.source, item.id), { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = item.file_name
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error("Failed to download file")
    }
  }

  async function confirmDelete() {
    if (!deleteItem) return
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const res = await fetch(attachmentItemPath(deleteItem.source, deleteItem.id), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error()
      clearApiCache()
      toast.success("Attachment deleted")
      setDeleteItem(null)
      load()
    } catch {
      toast.error("Failed to delete attachment")
      setDeleteItem(null)
    }
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(id ? `/clients/${id}` : "/clients")} className="-ml-2 shrink-0">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">Files</h1>
          {client && <p className="text-sm text-muted-foreground truncate">{client.name}</p>}
        </div>
        {canModify && (
          <>
            <Button onClick={() => fileRef.current?.click()} disabled={uploading} className="shrink-0 px-2.5 sm:px-4">
              {uploading ? <Loader className="size-4 animate-spin" /> : <Upload className="size-4" />}
              <span className="hidden sm:inline">Upload</span>
            </Button>
            <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={onUploadSelect} />
          </>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:flex-wrap">
        <ExpandableSearch value={query} onChange={setQuery} placeholder="Search files…" expandedClassName="w-full sm:w-64" />
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as "all" | AttachmentParent)}>
            <SelectTrigger className="h-9 sm:w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="client">Documents</SelectItem>
              <SelectItem value="transaction">Transactions</SelectItem>
              <SelectItem value="quotation">Quotes</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-9 sm:w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="name">Name (A–Z)</SelectItem>
              <SelectItem value="largest">Largest</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-9 flex-1 sm:w-[8.5rem]" aria-label="From date" />
          <span className="text-muted-foreground text-sm">–</span>
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9 flex-1 sm:w-[8.5rem]" aria-label="To date" />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2.5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <FileText className="size-8 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No files yet for this client.</p>
          {canModify && <p className="text-xs text-muted-foreground mt-1">Upload documents, or attach files to transactions and quotations.</p>}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No files match your filters.</p>
        </div>
      ) : (
        <>
          <ul className="space-y-2.5">
            {pageItems.map((item) => {
              const badge = SOURCE_BADGE[item.source]
              const navigable = item.source !== "client"
              return (
                <li
                  key={`${item.source}-${item.id}`}
                  className="flex items-center gap-3 rounded-xl border p-3 sm:p-3.5 hover:bg-muted/40 transition-colors cursor-pointer"
                  onClick={() => openModal(item)}
                >
                  <div className="size-9 sm:size-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <FileText className="size-4 sm:size-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{item.display_name || item.file_name}</p>
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
                        {navigable && <ExternalLink className="size-2.5" />}
                        {badge.label}
                      </span>
                      {item.category && <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">{item.category}</span>}
                      {navigable && <span className="text-xs text-muted-foreground max-w-[12rem] truncate">{item.source_label}</span>}
                      <span className="text-xs text-muted-foreground">{extOf(item.file_name)}</span>
                      <span className="text-xs text-muted-foreground">{formatSize(item.file_size)}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(item.created_at)}</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="shrink-0" onClick={(e) => { e.stopPropagation(); download(item) }} aria-label="Download">
                    <Download className="size-4" />
                  </Button>
                  {canRemove && (
                    <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteItem(item) }} aria-label="Delete">
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>

          {/* Pagination */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <p className="text-xs text-muted-foreground">
              {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon-sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page">
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">{safePage} / {totalPages}</span>
                <Button variant="outline" size="icon-sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="Next page">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      <AlertDialog open={deleteItem !== null} onOpenChange={(open) => { if (!open) setDeleteItem(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete attachment?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes “{deleteItem?.file_name}” from its {deleteItem ? SOURCE_BADGE[deleteItem.source].label.toLowerCase() : ""}. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AttachmentDetailModal
        item={modalItem as AttachmentModalItem | null}
        open={modalItem !== null}
        onOpenChange={(o) => { if (!o) closeModal() }}
        canEdit={canModify}
        canDelete={canRemove}
        onUpdated={(updated) => {
          setItems((prev) => prev.map((i) => (i.id === updated.id ? { ...i, display_name: updated.display_name, tags: updated.tags, category: updated.category } : i)))
        }}
        onDeleted={(deletedId) => {
          setItems((prev) => prev.filter((i) => i.id !== deletedId))
          closeModal()
          clearApiCache()
        }}
      />
    </div>
  )
}
