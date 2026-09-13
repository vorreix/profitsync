import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ArrowRight, ChevronDown } from "lucide-react"
import { usePersistedOpen } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { Collapse } from "@/components/Collapse"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

/**
 * The shell every hub-summary card on the dashboard wears: Wealth, Debt &
 * Loans, Spaces, Money flow.
 *
 * THE ANSWER LIVES IN THE HEADER. Each of these cards exists to answer one
 * question — how much do I have, how much do I owe, how much have I saved,
 * where is the money going — and that answer is now on the title row, beside
 * the name, where it is legible whether the card is open or shut. What used to
 * be a tall gradient hero repeating the same figure below the title is gone;
 * the detail underneath is the part worth folding away.
 *
 * So a collapsed card is ONE ROW and still says everything it is for, four of
 * them fit where two used to, and the state persists per card per workspace.
 * The same component runs on a phone, so the fold is not a desktop-only trick.
 */
export function SummaryCard({
  icon,
  title,
  count,
  headline,
  headlineClass,
  subline,
  storageKey,
  onOpen,
  openLabel,
  action,
  children,
  className = "",
}: {
  icon: ReactNode
  title: string
  /** Shown as a pill beside the title when > 0. */
  count?: number
  /** The one figure this card exists to show. Stays visible when collapsed. */
  headline?: ReactNode
  headlineClass?: string
  subline?: ReactNode
  /** Where the open/shut state is remembered. Include the workspace id. */
  storageKey: string
  /** Opens the full page this card summarises. */
  onOpen?: () => void
  /** Defaults to "View all". */
  openLabel?: string
  /** An extra control on the title row (the Wealth card's privacy eye). */
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = usePersistedOpen(storageKey)
  const toggle = () => setOpen(!open)

  return (
    <Card className={cn("flex h-full min-w-0 flex-col gap-0 py-0", className)}>
      <div className="flex items-center gap-1.5 px-3 sm:px-4">
        {/* The whole title row folds the card. A big, obvious target beats a
            12px chevron, and the chevron below still works for anyone who
            aims at it. */}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="pressable flex min-h-12 min-w-0 flex-1 items-center gap-2.5 py-2 text-left"
        >
          <span className="shrink-0 text-primary">{icon}</span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{title}</span>
            {count != null && count > 0 && (
              <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">{count}</span>
            )}
          </span>
          {headline != null && (
            <span className="ms-auto min-w-0 ps-2 text-end">
              <span className={cn("block truncate text-base font-bold tabular-nums sm:text-lg", headlineClass)}>{headline}</span>
              {subline != null && <span className="block truncate text-[11px] text-muted-foreground">{subline}</span>}
            </span>
          )}
        </button>
        {action}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={title}
          className="pressable grid size-11 shrink-0 place-items-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown className={cn("size-4 transition-transform duration-300 ease-out motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
        </button>
      </div>

      <Collapse open={open}>
        <div className="space-y-2.5 border-t px-3 py-3 sm:px-4">
          {children}
          {onOpen && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" className="-me-2 h-11 text-xs sm:h-8" onClick={onOpen}>
                {openLabel ?? t("common.viewAll")} <ArrowRight className="size-3 ms-1 rtl:rotate-180" />
              </Button>
            </div>
          )}
        </div>
      </Collapse>
    </Card>
  )
}
