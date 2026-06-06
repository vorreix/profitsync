import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { Check, ChevronsUpDown, Pencil, Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useDialogContainer } from "@/hooks/use-dialog-container"
import { apiDelete, apiPatch, apiPost } from "@/lib/api"
import { useCategories } from "@/lib/use-categories"
import type { CategoryType } from "@/lib/types"

/**
 * Category picker backed by the org's managed categories for a given type
 * (income / expense / client / quotation). Lets you select an existing one or
 * add a new one inline (persists to /api/categories). Stores the category *name*.
 * Full management (rename/delete) lives on the Categories page.
 */
export function CategoryPicker({
  type,
  value,
  onChange,
  disabled,
}: {
  type: CategoryType
  value: string
  onChange: (name: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { categories, refresh } = useCategories()
  const { triggerRef, container } = useDialogContainer()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editVal, setEditVal] = useState("")

  const typed = useMemo(() => categories.filter((c) => c.type === type), [categories, type])
  const names = useMemo(() => typed.map((c) => c.name), [typed])
  const q = search.trim().toLowerCase()
  const filtered = useMemo(() => typed.filter((c) => c.name.toLowerCase().includes(q)), [typed, q])
  // The current value when it isn't a managed category (free text) — shown but
  // not editable/deletable.
  const freeValue = value && !names.includes(value) ? value : null
  const canAdd = search.trim() !== "" && !names.some((n) => n.toLowerCase() === search.trim().toLowerCase())

  function close() {
    setOpen(false)
    setSearch("")
    setEditingId(null)
  }

  async function addNew() {
    const name = search.trim()
    if (!name) return
    setAdding(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPost("/api/categories", token, { name, type })
      await refresh()
      onChange(name)
      close()
    } finally {
      setAdding(false)
    }
  }

  async function saveEdit(cat: { id: string; name: string }) {
    const name = editVal.trim()
    if (!name || (name !== cat.name && names.some((n) => n.toLowerCase() === name.toLowerCase()))) { setEditingId(null); return }
    setEditingId(null)
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch(`/api/categories/${cat.id}`, token, { name })
      await refresh()
      if (value === cat.name) onChange(name)
    } catch { /* keep previous */ }
  }

  async function removeCat(cat: { id: string; name: string }) {
    try {
      const token = await getToken()
      if (!token) return
      await apiDelete(`/api/categories/${cat.id}`, token)
      await refresh()
      if (value === cat.name) onChange("")
    } catch { /* keep previous */ }
  }

  return (
    <div ref={triggerRef} className="contents">
    <Popover open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal" disabled={disabled}>
          {value || <span className="text-muted-foreground">{t("filters.category")}</span>}
          <ChevronsUpDown className="size-4 ml-2 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={container}
        className="flex max-h-[min(20rem,var(--radix-popover-content-available-height,20rem))] w-[var(--radix-popover-trigger-width)] flex-col overflow-hidden p-0"
        align="start"
      >
        <div className="p-2 border-b shrink-0">
          <Input
            placeholder={t("categories.searchOrAdd", { defaultValue: "Search or type to add…" })}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canAdd) addNew() }}
            className="h-8 text-sm"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin p-1">
            {value && (
              <button type="button" className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent" onClick={() => { onChange(""); close() }}>
                <span className="size-4 shrink-0" />
                <span className="text-muted-foreground">{t("filters.all", { defaultValue: "None" })}</span>
              </button>
            )}
            {freeValue && (
              <button type="button" className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent" onClick={() => close()}>
                <Check className="size-4 shrink-0 opacity-100" />
                <span className="truncate">{freeValue}</span>
              </button>
            )}
            {filtered.map((cat) => (
              <div key={cat.id} className="group flex items-center gap-0.5">
                {editingId === cat.id ? (
                  <>
                    <Input
                      value={editVal}
                      onChange={(e) => setEditVal(e.target.value)}
                      className="h-7 flex-1 text-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(cat)
                        if (e.key === "Escape") setEditingId(null)
                      }}
                    />
                    <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => saveEdit(cat)}><Check className="size-3" /></Button>
                    <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => setEditingId(null)}><X className="size-3" /></Button>
                  </>
                ) : (
                  <>
                    <button type="button" className="flex flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => { onChange(cat.name); close() }}>
                      <Check className={cn("size-4 shrink-0", value === cat.name ? "opacity-100" : "opacity-0")} />
                      <span className="truncate">{cat.name}</span>
                    </button>
                    <Button size="icon" variant="ghost" className="size-7 shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); setEditingId(cat.id); setEditVal(cat.name) }}>
                      <Pencil className="size-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-7 shrink-0 text-muted-foreground opacity-100 transition-opacity hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); removeCat(cat) }}>
                      <X className="size-3" />
                    </Button>
                  </>
                )}
              </div>
            ))}
            {canAdd && (
              <button type="button" disabled={adding} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent text-primary" onClick={addNew}>
                <Plus className="size-4 shrink-0" />
                <span className="truncate">{t("categories.addNamed", { name: search.trim(), defaultValue: `Add "${search.trim()}"` })}</span>
              </button>
            )}
            {filtered.length === 0 && !freeValue && !canAdd && (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("categories.noMatch")}</p>
            )}
        </div>
      </PopoverContent>
    </Popover>
    </div>
  )
}
