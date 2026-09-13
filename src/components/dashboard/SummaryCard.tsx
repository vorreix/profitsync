import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, ChevronRight } from "lucide-react"
import { usePersistedOpen } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { Collapse } from "@/components/Collapse"
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
 *
 * TWO ZONES, SPLIT AT THE ARROW. Everything up to and including the little
 * chevron after the title opens the full page — from the folded card, in one
 * tap, which is the whole point of putting the answer in the header. Everything
 * to the RIGHT of it, the figure itself, folds the card open and shut, as does
 * the chevron at the end. So the name takes you there and the number opens the
 * detail behind it, which is what each of them already means.
 *
 * Burying the way through to the page at the BOTTOM of the expanded body meant
 * expanding a card you did not want expanded and scrolling past its detail to
 * leave it.
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
  /** Opens the full page this card summarises — the row itself is the link. */
  onOpen?: () => void
  children: ReactNode
  className?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = usePersistedOpen(storageKey)
  const toggle = () => setOpen(!open)

  return (
    <Card className={cn("flex h-full min-w-0 flex-col gap-0 py-0", className)}>
      <div className="flex items-center gap-1 px-3 sm:px-4">
        {/* NAME → the page. Named by its own content, so a screen reader hears
            "Wealth 6" and knows where it goes. */}
        <button
          type="button"
          onClick={onOpen}
          disabled={!onOpen}
          className="pressable group flex min-h-12 shrink-0 items-center gap-2.5 py-2 text-left disabled:pointer-events-none"
        >
          <span className="shrink-0 text-primary">{icon}</span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{title}</span>
            {count != null && count > 0 && (
              <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">{count}</span>
            )}
            {/* Says "this goes somewhere" without waiting for a hover that a
                phone never gets. It is the last thing inside the link, so the
                split between the two zones is visible, not guessed at. */}
            {onOpen && (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden />
            )}
          </span>
        </button>
        {/* NUMBER → the detail behind it. Fills the rest of the row so there is
            no dead strip between the two zones. */}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={t(open ? "common.collapse" : "common.expand")}
          className="pressable flex min-h-12 min-w-0 flex-1 items-center justify-end py-2 text-end"
        >
          {headline != null && (
            <span className="min-w-0 ps-2">
              <span className={cn("block truncate text-base font-bold tabular-nums sm:text-lg", headlineClass)}>{headline}</span>
              {subline != null && <span className="block truncate text-[11px] text-muted-foreground">{subline}</span>}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={t(open ? "common.collapse" : "common.expand")}
          className="pressable grid size-11 shrink-0 place-items-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown className={cn("size-4 transition-transform duration-300 ease-out motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
        </button>
      </div>

      <Collapse open={open}>
        <div className="space-y-2.5 border-t px-3 py-3 sm:px-4">{children}</div>
      </Collapse>
    </Card>
  )
}
