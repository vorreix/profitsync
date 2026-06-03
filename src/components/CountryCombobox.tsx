import { useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { COUNTRIES, countryByCode } from "@/lib/countries"

function matches(code: string, search: string): boolean {
  const c = countryByCode(code)
  if (!c) return false
  const q = search.toLowerCase()
  return c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || c.dial.includes(q)
}

/** Address country picker (value = ISO alpha-2 code). */
export function CountryCombobox({
  value,
  onValueChange,
  disabled,
  placeholder = "Select country…",
}: {
  value: string
  onValueChange: (code: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = countryByCode(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal" disabled={disabled}>
          <span className="truncate">{selected ? `${selected.flag} ${selected.name}` : placeholder}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[14rem] max-w-[calc(100vw-1.5rem)] p-0 sm:w-[360px]" align="start">
        <Command filter={(v, s) => (matches(v, s) ? 1 : 0)}>
          <CommandInput placeholder="Search country…" />
          <CommandList className="max-h-64">
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {COUNTRIES.map((c) => (
                <CommandItem key={c.code} value={c.code} onSelect={(val) => { onValueChange(val.toUpperCase()); setOpen(false) }}>
                  <Check className={cn("mr-2 size-4 shrink-0", value === c.code ? "opacity-100" : "opacity-0")} />
                  <span className="mr-2">{c.flag}</span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground ml-2 shrink-0">{c.dial}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Phone dial-code picker (value = dial string, e.g. "+91"). */
export function CountryCodeCombobox({
  value,
  onValueChange,
  disabled,
}: {
  value: string
  onValueChange: (dial: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  // A dial code can map to several countries (+1); just show the code.
  const selected = COUNTRIES.find((c) => c.dial === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-[5.5rem] shrink-0 justify-between px-2.5 font-normal tabular-nums" disabled={disabled}>
          <span className="truncate">{value ? `${selected?.flag ?? ""} ${value}` : "+__"}</span>
          <ChevronsUpDown className="ml-1 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[16rem] max-w-[calc(100vw-1.5rem)] p-0" align="start">
        <Command filter={(v, s) => (matches(v, s) ? 1 : 0)}>
          <CommandInput placeholder="Search code…" />
          <CommandList className="max-h-64">
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {COUNTRIES.map((c) => (
                <CommandItem key={c.code} value={c.code} onSelect={() => { onValueChange(c.dial); setOpen(false) }}>
                  <span className="mr-2">{c.flag}</span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground ml-2 shrink-0 tabular-nums">{c.dial}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
