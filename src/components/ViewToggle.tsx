import { LayoutGrid, LayoutList, Table2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ALL_VIEW_MODES, type ViewMode } from "@/lib/use-view-mode"

const ICONS: Record<ViewMode, typeof LayoutGrid> = {
  card: LayoutGrid,
  list: LayoutList,
  table: Table2,
}

interface ViewToggleProps {
  value: ViewMode
  onChange: (mode: ViewMode) => void
  /** Which modes to show (order preserved). Defaults to Card · List · Table. */
  available?: readonly ViewMode[]
  className?: string
}

/**
 * Segmented Card / List / Table switcher shared by the Quotations and Clients
 * sections. Shown on mobile too (the Table view scrolls horizontally on narrow
 * screens), so — unlike the old `hidden sm:flex` toggle — there is no breakpoint
 * gate here.
 *
 * Accessible: a labelled `radiogroup`, each button an `aria-pressed` toggle with a
 * translated `aria-label`; 36px hit targets sit inside the 44px touch row.
 */
export function ViewToggle({ value, onChange, available = ALL_VIEW_MODES, className }: ViewToggleProps) {
  const { t } = useTranslation()
  if (available.length < 2) return null

  return (
    <div
      role="radiogroup"
      aria-label={t("view.label")}
      className={cn("flex items-center border rounded-md overflow-hidden shrink-0", className)}
    >
      {available.map((mode) => {
        const Icon = ICONS[mode]
        const active = value === mode
        const label = t(`view.${mode}`)
        return (
          <Button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            variant={active ? "secondary" : "ghost"}
            size="icon"
            className="rounded-none border-0 h-9 w-9"
            onClick={() => onChange(mode)}
          >
            <Icon className="size-4" />
          </Button>
        )
      })}
    </div>
  )
}
