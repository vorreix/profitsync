import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { Building2, Mail, Phone, Calendar, FileText, Pencil, ExternalLink } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useCurrency } from "@/lib/currency-context"
import type { Client } from "@/lib/types"

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

/**
 * Quick, read-only full view of a client (mobile "eye" action). Shows every
 * detail — company, contacts, notes, dates, financial summary — and links
 * through to the full client page to edit.
 */
export function ClientDetailSheet({
  client,
  open,
  onOpenChange,
}: {
  client: (Client & { profit?: number }) | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation("clients")
  const navigate = useNavigate()
  const { currency } = useCurrency()
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
  if (!client) return null

  const incoming = Number(client.total_incoming ?? 0)
  const outgoing = Number(client.total_outgoing ?? 0)
  const profit = incoming - outgoing

  const rows: { icon: typeof Mail; label: string; value: string }[] = [
    client.company ? { icon: Building2, label: t("companyField"), value: client.company } : null,
    client.email ? { icon: Mail, label: t("emailField"), value: client.email } : null,
    client.phone ? { icon: Phone, label: t("phoneField"), value: client.phone } : null,
    client.onboard_date ? { icon: Calendar, label: t("onboardDateField"), value: formatDate(client.onboard_date) } : null,
    { icon: Calendar, label: t("clientSince", { defaultValue: "Client since" }), value: formatDate(client.created_at) },
  ].filter(Boolean) as { icon: typeof Mail; label: string; value: string }[]

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[88vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2 flex-wrap pr-6">
            {client.name}
            <Badge variant={client.status === "active" ? "default" : "secondary"} className="text-xs">{client.status}</Badge>
            {client.closed_at && <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-600 dark:text-amber-300">Closed</Badge>}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          {/* Financial summary */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border p-2.5">
              <p className="text-[11px] text-muted-foreground">{t("incomeLabel")}</p>
              <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">{fmt(incoming)}</p>
            </div>
            <div className="rounded-lg border p-2.5">
              <p className="text-[11px] text-muted-foreground">{t("expenseLabel")}</p>
              <p className="text-sm font-semibold text-red-600 dark:text-red-400 tabular-nums">{fmt(outgoing)}</p>
            </div>
            <div className="rounded-lg border p-2.5">
              <p className="text-[11px] text-muted-foreground">{t("profitLabel")}</p>
              <p className={`text-sm font-semibold tabular-nums ${profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>{fmt(profit)}</p>
            </div>
          </div>

          {/* Details */}
          <div className="space-y-2.5">
            {rows.map((r, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <r.icon className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">{r.label}</p>
                  <p className="text-sm break-words">{r.value}</p>
                </div>
              </div>
            ))}
            {client.notes && (
              <div className="flex items-start gap-2.5">
                <FileText className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">{t("notesField")}</p>
                  <p className="text-sm whitespace-pre-wrap break-words">{client.notes}</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => { onOpenChange(false); navigate(`/clients/${client.id}`) }}>
              <ExternalLink className="size-4" /> {t("open", { defaultValue: "Open" })}
            </Button>
            <Button className="flex-1" onClick={() => { onOpenChange(false); navigate(`/clients/${client.id}?edit=1`) }}>
              <Pencil className="size-4" /> {t("editButton", { defaultValue: "Edit" })}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
