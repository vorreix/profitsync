import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowDownRight, ArrowUpRight, Check, ChevronsUpDown, Pencil, Plus, X } from "lucide-react"
import type { Budget, Client, WealthAccount } from "@/lib/types"
import { budgetState } from "@/lib/budget"
import { formatMoney } from "@/lib/wealth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { AccountSelector } from "@/components/AccountSelector"
import { useDialogContainer } from "@/hooks/use-dialog-container"
import type { TxForm } from "./tx-form-utils"


// ─── Client combobox ─────────────────────────────────────────────────────────

function ClientCombobox({ clients, value, onChange }: {
  clients: Client[]
  value: string
  onChange: (id: string) => void
}) {
  const { t } = useTranslation("transactions")
  const { triggerRef, container } = useDialogContainer()
  const [open, setOpen] = useState(false)
  const selected = clients.find((c) => c.id === value)

  return (
    <div ref={triggerRef} className="contents">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
          {selected
            ? `${selected.name}${selected.company ? ` — ${selected.company}` : ""}`
            : <span className="text-muted-foreground">{t("selectClient")}</span>}
          <ChevronsUpDown className="size-4 ml-2 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={container}
        className="max-h-[min(20rem,var(--radix-popover-content-available-height,20rem))] w-[--radix-popover-trigger-width] overflow-hidden p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={t("searchClients")} />
          <CommandList className="scrollbar-thin">
            <CommandEmpty>{t("noClientFound")}</CommandEmpty>
            <CommandGroup>
              {clients.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.name} ${c.company}`}
                  onSelect={() => { onChange(c.id); setOpen(false) }}
                >
                  <Check className={`mr-2 size-4 shrink-0 ${value === c.id ? "opacity-100" : "opacity-0"}`} />
                  <span className="truncate">{c.name}{c.company ? ` — ${c.company}` : ""}</span>
                  {c.is_own && (
                    <Badge variant="outline" className="ml-auto text-[10px] py-0 shrink-0">{t("own")}</Badge>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    </div>
  )
}

// ─── Category combobox ────────────────────────────────────────────────────────

function CategoryCombobox({ categories, value, onChangeCategories, onChange }: {
  categories: string[]
  value: string
  onChangeCategories: (cats: string[]) => void
  onChange: (v: string) => void
}) {
  const { t } = useTranslation("transactions")
  const { triggerRef, container } = useDialogContainer()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editVal, setEditVal] = useState("")

  const filtered = categories.filter((c) => c.toLowerCase().includes(search.toLowerCase()))
  const canAdd = search.trim() !== "" && !categories.some((c) => c.toLowerCase() === search.trim().toLowerCase())

  function close() { setOpen(false); setSearch(""); setEditingIdx(null) }
  function select(cat: string) { onChange(cat); close() }
  function addCategory() {
    const name = search.trim()
    if (!name) return
    onChangeCategories([...categories, name])
    onChange(name)
    close()
  }
  function startEdit(idx: number) { setEditingIdx(idx); setEditVal(categories[idx]) }
  function saveEdit(idx: number) {
    const trimmed = editVal.trim()
    if (!trimmed) return
    if (trimmed !== categories[idx] && categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return
    const next = [...categories]
    const old = next[idx]
    next[idx] = trimmed
    onChangeCategories(next)
    if (value === old) onChange(trimmed)
    setEditingIdx(null)
  }
  function deleteCategory(idx: number) {
    const next = categories.filter((_, i) => i !== idx)
    onChangeCategories(next)
    if (value === categories[idx]) onChange("")
  }

  return (
    <div ref={triggerRef} className="contents">
    <Popover open={open} onOpenChange={(o) => { if (!o) close(); else setOpen(true) }}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
          {value || <span className="text-muted-foreground">{t("select")}</span>}
          <ChevronsUpDown className="size-4 ml-2 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={container}
        className="flex max-h-[min(20rem,var(--radix-popover-content-available-height,20rem))] w-[--radix-popover-trigger-width] flex-col overflow-hidden p-0"
        align="start"
      >
        <div className="p-2 border-b shrink-0">
          <Input
            placeholder={t("searchOrTypeToAdd")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
            onKeyDown={(e) => { if (e.key === "Enter" && canAdd) addCategory() }}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
          {filtered.length === 0 && !canAdd && (
            <p className="text-xs text-muted-foreground text-center py-4">{t("noCategoriesFound")}</p>
          )}
          {filtered.map((cat) => {
            const realIdx = categories.indexOf(cat)
            return (
              <div key={cat} className="flex items-center gap-0.5 px-1 py-0.5 group">
                {editingIdx === realIdx ? (
                  <>
                    <Input
                      value={editVal}
                      onChange={(e) => setEditVal(e.target.value)}
                      className="h-7 text-sm flex-1"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(realIdx)
                        if (e.key === "Escape") setEditingIdx(null)
                      }}
                    />
                    <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => saveEdit(realIdx)}>
                      <Check className="size-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => setEditingIdx(null)}>
                      <X className="size-3" />
                    </Button>
                  </>
                ) : (
                  <>
                    <button
                      className="flex-1 text-sm text-left py-1.5 px-2 rounded-md hover:bg-muted transition-colors flex items-center gap-2"
                      onClick={() => select(cat)}
                    >
                      <Check className={`size-3 shrink-0 text-primary ${value === cat ? "opacity-100" : "opacity-0"}`} />
                      {cat}
                    </button>
                    <Button
                      size="icon" variant="ghost"
                      className="size-7 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); startEdit(realIdx) }}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      size="icon" variant="ghost"
                      className="size-7 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); deleteCategory(realIdx) }}
                    >
                      <X className="size-3" />
                    </Button>
                  </>
                )}
              </div>
            )
          })}
          {canAdd && (
            <button
              className="w-full text-left text-sm px-3 py-2 flex items-center gap-2 text-primary hover:bg-muted transition-colors"
              onClick={addCategory}
            >
              <Plus className="size-3.5" />
              {t("addCategory", { category: search.trim() })}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
    </div>
  )
}

// ─── Transaction form fields ──────────────────────────────────────────────────

export function TxFormFields({
  f, onChange, showClient, clients, accounts, accountsLoading, categories, onChangeCats, onAddAccount, currency, singleAccount = false, budget = null,
}: {
  f: TxForm
  onChange: (patch: Partial<TxForm>) => void
  showClient: boolean
  clients: Client[]
  accounts: WealthAccount[]
  accountsLoading: boolean
  categories: { incoming: string[]; outgoing: string[] }
  onChangeCats: (type: "incoming" | "outgoing", cats: string[]) => void
  onAddAccount: () => void
  currency: string
  singleAccount?: boolean
  // The resolved expense budget for the current client (or personal/org budget),
  // used to show the live "x left after this expense" impact on outgoing.
  budget?: Budget | null
}) {
  const { t } = useTranslation("transactions")
  const cats = f.type === "incoming" ? categories.incoming : categories.outgoing
  const txTotal = f.allocations.reduce((sum, a) => sum + (Number(a.amount) || 0), 0)
  const budgetHint = (() => {
    if (f.type !== "outgoing" || !budget || budget.amount <= 0 || txTotal <= 0) return null
    const { remaining, state } = budgetState((budget.spent ?? 0) + txTotal, budget.amount)
    return remaining >= 0
      ? { over: false, state, text: t("budget.remainingAfter", { ns: "translation", amount: formatMoney(remaining, currency) }) }
      : { over: true, state, text: t("budget.overAfter", { ns: "translation", amount: formatMoney(-remaining, currency) }) }
  })()

  return (
    <div className="space-y-4 py-2">
      {showClient && (
        <div className="space-y-1.5">
          <Label>{t("clientRequired")}</Label>
          <ClientCombobox clients={clients} value={f.client_id} onChange={(id) => onChange({ client_id: id })} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label>{t("type")}</Label>
        <div className="grid grid-cols-2 gap-2">
          {(["incoming", "outgoing"] as const).map((type) => (
            <button key={type} type="button" onClick={() => onChange({ type, category: "" })} className={`flex items-center justify-center gap-2 rounded-md border py-2.5 text-sm font-medium transition-colors ${
              f.type === type
                ? type === "incoming"
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-600"
                  : "border-red-500 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 dark:border-red-600"
                : "border-border hover:bg-muted"
            }`}>
              {type === "incoming" ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
              {t(type)}
            </button>
          ))}
        </div>
      </div>
      <AccountSelector
        accounts={accounts}
        allocations={f.allocations}
        onChange={(allocations) => onChange({ allocations })}
        currency={currency}
        max={singleAccount ? 1 : Infinity}
        onAddAccount={onAddAccount}
        loading={accountsLoading}
      />
      {budgetHint && (
        <p className={`-mt-1 text-xs ${budgetHint.over ? "text-red-600 dark:text-red-400" : budgetHint.state === "warn" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
          {budgetHint.text}
        </p>
      )}
      <div className="space-y-1.5">
        <Label>{t("description")}</Label>
        <Textarea
          placeholder={f.type === "incoming" ? t("invoicePlaceholder") : t("hostingFeePlaceholder")}
          value={f.description}
          onChange={(e) => onChange({ description: e.target.value })}
          rows={3}
          className="resize-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("category")}</Label>
          <CategoryCombobox
            categories={cats}
            value={f.category}
            onChangeCategories={(next) => onChangeCats(f.type, next)}
            onChange={(v) => onChange({ category: v })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("date")}</Label>
          <Input type="date" value={f.date} onChange={(e) => onChange({ date: e.target.value })} />
        </div>
      </div>
    </div>
  )
}
