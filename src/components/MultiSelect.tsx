import { useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useDialogContainer } from "@/hooks/use-dialog-container"

export type MultiSelectOption = { value: string; label: string }

type Props = {
  options: MultiSelectOption[]
  selected: string[]
  onChange: (next: string[]) => void
  /** Label shown when nothing is selected. */
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
}

/**
 * Searchable multi-select (checkbox list in a popover). Safe inside a Dialog —
 * portals into the dialog container so the list scrolls (see use-dialog-container).
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Any",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  disabled,
  className,
}: Props) {
  const { triggerRef, container } = useDialogContainer()
  const [open, setOpen] = useState(false)
  const selectedSet = new Set(selected)

  const toggle = (value: string) => {
    const next = new Set(selectedSet)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange([...next])
  }

  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label ?? "1 selected"
        : `${selected.length} selected`

  return (
    <div ref={triggerRef} className="contents">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn("w-full justify-between font-normal", selected.length === 0 && "text-muted-foreground", className)}
          >
            <span className="truncate">{label}</span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          container={container}
          className="flex max-h-[min(20rem,var(--radix-popover-content-available-height,20rem))] w-[var(--radix-popover-trigger-width)] min-w-[14rem] flex-col overflow-hidden p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {selected.length > 0 && (
                  <CommandItem value="__clear__" onSelect={() => onChange([])} className="text-muted-foreground">
                    <Check className="mr-2 size-4 opacity-0" />
                    Clear selection
                  </CommandItem>
                )}
                {options.map((o) => {
                  const checked = selectedSet.has(o.value)
                  return (
                    <CommandItem key={o.value} value={`${o.label} ${o.value}`} onSelect={() => toggle(o.value)}>
                      <Check className={cn("mr-2 size-4", checked ? "opacity-100" : "opacity-0")} />
                      <span className="truncate">{o.label}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
