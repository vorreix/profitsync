import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useIsMobile } from "@/hooks/use-mobile"
import { useRegisterPageFilter } from "@/lib/page-filter-context"
import { cn } from "@/lib/utils"

/**
 * Shared filter/sort control used across Dashboard, Clients, Transactions and
 * Quotations. Renders a single compact "filter" trigger (icon + applied-count
 * badge) that opens a bottom Sheet on mobile or a Popover on desktop, holding
 * the page's sort + filter controls. It also publishes the count + opener to the
 * shell so a floating shortcut appears above the FAB on mobile.
 *
 * The page owns all filter state and passes the controls as `children` plus an
 * `onClear` to reset them; `count` is the number of applied filters.
 */
export function FilterSheet({
  count,
  onClear,
  children,
  title,
  triggerClassName,
  align = "end",
  registerFloating = true,
}: {
  count: number
  onClear: () => void
  children: ReactNode
  title?: string
  triggerClassName?: string
  align?: "start" | "center" | "end"
  /** When false, no floating shortcut is registered for the mobile FAB. */
  registerFloating?: boolean
}) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  useRegisterPageFilter({
    count,
    onOpen: () => setOpen(true),
    enabled: registerFloating && count > 0,
  })

  const heading = title ?? t("filters.filters")

  const footer = (
    <div className="flex gap-2 pt-3">
      <Button variant="outline" size="sm" className="flex-1" onClick={onClear}>
        {t("filters.clearAll")}
      </Button>
      <Button size="sm" className="flex-1" onClick={() => setOpen(false)}>
        {t("common.done")}
      </Button>
    </div>
  )

  if (isMobile) {
    return (
      <>
        <FilterTriggerButton
          count={count}
          className={triggerClassName}
          onClick={() => setOpen(true)}
        />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
            <SheetHeader className="text-left">
              <SheetTitle>{heading}</SheetTitle>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-4">
              {children}
              {footer}
            </div>
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FilterTriggerButton count={count} className={triggerClassName} />
      </PopoverTrigger>
      <PopoverContent align={align} className="w-72">
        <div className="space-y-4">
          {children}
          {footer}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** The trigger button shown in a page toolbar: filter icon + count badge. */
export function FilterTriggerButton({
  count,
  className,
  ...props
}: { count: number; className?: string } & React.ComponentProps<typeof Button>) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={t("filters.filters")}
      className={cn("relative h-9 gap-1.5", className)}
      {...props}
    >
      <SlidersHorizontal className="size-4" />
      <span className="hidden sm:inline">{t("filters.filters")}</span>
      {count > 0 && (
        <Badge
          className="ml-0.5 size-5 shrink-0 justify-center rounded-full p-0 text-[10px] tabular-nums"
          variant="default"
        >
          {count}
        </Badge>
      )}
    </Button>
  )
}

/** Labelled section inside a filter sheet/popover. */
export function FilterSection({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}
