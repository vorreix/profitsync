import { useTranslation } from "react-i18next"
import { AlertTriangle, CheckCircle2, Clock, PauseCircle } from "lucide-react"
import type { DebtStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

/** Textual status — words carry the meaning, colour only reinforces it. Calm palette on purpose. */
export function DebtStatusBadge({ status, className }: { status: DebtStatus; className?: string }) {
  const { t } = useTranslation("debts")
  const map: Record<DebtStatus, { className: string; Icon?: typeof Clock }> = {
    active: { className: "border-border bg-muted text-foreground" },
    due_soon: { className: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300", Icon: Clock },
    overdue: { className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300", Icon: AlertTriangle },
    paused: { className: "border-border bg-muted text-muted-foreground", Icon: PauseCircle },
    paid_off: { className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", Icon: CheckCircle2 },
    refinanced: { className: "border-border bg-muted text-muted-foreground" },
    written_off: { className: "border-border bg-muted text-muted-foreground" },
  }
  const m = map[status] ?? map.active
  return (
    <Badge variant="outline" className={cn("gap-1 py-0 text-[11px]", m.className, className)}>
      {m.Icon && <m.Icon className="size-3" aria-hidden />}
      {t(`status.${status}`)}
    </Badge>
  )
}
