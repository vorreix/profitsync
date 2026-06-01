import { useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CURRENCY_LIST } from "@/lib/currencies"

type Props = {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}

export function CurrencyCombobox({ value, onValueChange, disabled }: Props) {
  const [open, setOpen] = useState(false)

  const selected = CURRENCY_LIST.find((c) => c.code === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={disabled}
        >
          <span className="truncate">
            {selected ? `${selected.code} — ${selected.name} (${selected.country})` : "Select currency..."}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[16rem] max-w-[calc(100vw-1.5rem)] p-0 sm:w-[400px]"
        align="start"
      >
        <Command filter={(itemValue, search) => {
          const currency = CURRENCY_LIST.find((c) => c.code === itemValue)
          if (!currency) return 0
          const q = search.toLowerCase()
          if (
            currency.code.toLowerCase().includes(q) ||
            currency.name.toLowerCase().includes(q) ||
            currency.country.toLowerCase().includes(q)
          ) return 1
          return 0
        }}>
          <CommandInput placeholder="Search by currency, code, or country..." />
          <CommandList className="max-h-64">
            <CommandEmpty>No currency found.</CommandEmpty>
            <CommandGroup>
              {CURRENCY_LIST.map((c) => (
                <CommandItem
                  key={c.code}
                  value={c.code}
                  onSelect={(val) => {
                    onValueChange(val.toUpperCase())
                    setOpen(false)
                  }}
                >
                  <Check className={cn("mr-2 size-4 shrink-0", value === c.code ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono text-xs text-muted-foreground w-10 shrink-0">{c.code}</span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground ml-2 shrink-0">{c.country}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
