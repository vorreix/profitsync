import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
import { DEBT_KIND_SUGGESTIONS, isSuggestedDebtKind, MAX_DEBT_KIND_LENGTH } from "@/lib/debt-recurring"
import { debtKindLabel } from "@/lib/debt-format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * What kind of debt this is — a suggestion or anything the user types.
 *
 * The nine suggestions cover the common shapes; they are not the world. People
 * owe money on a chit fund, a shop tab, a flatmate's half of the deposit, and a
 * closed list forces all of that into "Other", which tells them nothing when
 * they come back to it. So the field is free text with suggestions in front of
 * it: pick one, or type your own and it is kept exactly as written.
 */
export function DebtKindCombobox({ value, onChange, id }: { value: string; onChange: (kind: string) => void; id?: string }) {
  const { t } = useTranslation("debts")
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  const typed = query.trim().replace(/\s+/g, " ").slice(0, MAX_DEBT_KIND_LENGTH)
  const suggestions = useMemo(() => {
    const q = typed.toLowerCase()
    return DEBT_KIND_SUGGESTIONS.filter((k) => !q || debtKindLabel(k, t).toLowerCase().includes(q) || k.includes(q))
  }, [typed, t])
  // Only offer to create what isn't already on the list under either name.
  const canCreate = !!typed && !suggestions.some((k) => debtKindLabel(k, t).toLowerCase() === typed.toLowerCase()) && !isSuggestedDebtKind(typed.toLowerCase())

  const pick = (kind: string) => { onChange(kind); setQuery(""); setOpen(false) }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery("") }}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className="truncate">{value ? debtKindLabel(value, t) : t("kindPlaceholder")}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[14rem] p-0" align="start">
        {/* shouldFilter=false: the filtering is ours, because the "use what I
            typed" row must survive a query that matches no suggestion. */}
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t("kindSearchPlaceholder")} maxLength={MAX_DEBT_KIND_LENGTH} />
          <CommandList className="max-h-60">
            {canCreate && (
              <CommandGroup>
                <CommandItem value={`__create__${typed}`} onSelect={() => pick(typed)}>
                  <Plus className="size-4" />
                  <span className="truncate">{t("useThisType", { type: typed })}</span>
                </CommandItem>
              </CommandGroup>
            )}
            {/* No heading over an empty list: typing something the suggestions
                cannot match used to leave "Suggestions" standing over nothing. */}
            <CommandGroup heading={canCreate && suggestions.length > 0 ? t("kindSuggestions") : undefined}>
              {suggestions.map((k) => (
                <CommandItem key={k} value={k} onSelect={() => pick(k)}>
                  <Check className={cn("size-4", value === k ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{debtKindLabel(k, t)}</span>
                </CommandItem>
              ))}
              {/* A custom value the user already saved stays selectable. */}
              {value && !isSuggestedDebtKind(value) && !canCreate && (
                <CommandItem value={value} onSelect={() => pick(value)}>
                  <Check className="size-4 opacity-100" />
                  <span className="truncate">{value}</span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
