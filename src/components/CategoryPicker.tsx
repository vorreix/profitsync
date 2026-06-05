import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { apiPost } from "@/lib/api"
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
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [adding, setAdding] = useState(false)

  const names = useMemo(
    () => categories.filter((c) => c.type === type).map((c) => c.name),
    [categories, type],
  )
  // Always keep the current value visible even if not in the managed list.
  const options = value && !names.includes(value) ? [value, ...names] : names
  const q = search.trim().toLowerCase()
  const filtered = options.filter((n) => n.toLowerCase().includes(q))
  const canAdd = search.trim() !== "" && !options.some((n) => n.toLowerCase() === search.trim().toLowerCase())

  function close() {
    setOpen(false)
    setSearch("")
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

  return (
    <Popover open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal" disabled={disabled}>
          {value || <span className="text-muted-foreground">{t("filters.category")}</span>}
          <ChevronsUpDown className="size-4 ml-2 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
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
            {filtered.map((name) => (
              <button key={name} type="button" className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent" onClick={() => { onChange(name); close() }}>
                <Check className={cn("size-4 shrink-0", value === name ? "opacity-100" : "opacity-0")} />
                <span className="truncate">{name}</span>
              </button>
            ))}
            {canAdd && (
              <button type="button" disabled={adding} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent text-primary" onClick={addNew}>
                <Plus className="size-4 shrink-0" />
                <span className="truncate">{t("categories.addNamed", { name: search.trim(), defaultValue: `Add "${search.trim()}"` })}</span>
              </button>
            )}
            {filtered.length === 0 && !canAdd && (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("categories.noMatch")}</p>
            )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
