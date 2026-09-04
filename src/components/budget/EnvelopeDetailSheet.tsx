import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { apiGet } from "@/lib/api"
import { formatIsoDate } from "@/lib/dates"
import type { BudgetEnvelopeView } from "@/lib/types"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"

type DetailTx = {
  id: string
  date: string
  amount: number
  type: "incoming" | "outgoing"
  category: string | null
  description: string | null
  settlement_status: string | null
  settled_amount: number | null
  outstanding: number | null
  is_confirmed_settlement: boolean
}

type DetailHistory = {
  period_id: string
  start: string
  end_exclusive: string
  status: string
  name_at_close: string | null
  planned: number
  rollover_in: number
  spent_net: number | null
  remaining: number | null
  state: string | null
  restated_reason: string | null
}

/** Report-only economic view (§8.8.1) — never the operational figure. */
type Attributed = { settlements: number; gross: number; net_cost: number; note: string }

type Detail = {
  envelope: { id: string; name: string; section: string }
  attributed?: Attributed
  transactions: DetailTx[]
  history: DetailHistory[]
  events: { id: string; action: string; amount: string | null; created_at: string }[]
}

/**
 * One envelope in depth — the answer to "why is this number what it is"
 * (spec §6.9).
 *
 * A budget that shows a total it cannot break down is not auditable, which was
 * v1's defect #14. So this shows the actual rows behind the figure, the
 * settlement state of each, the envelope's history across closed periods, and
 * the audit trail.
 */
export function EnvelopeDetailSheet({
  envelope,
  money,
  onOpenChange,
}: {
  envelope: BudgetEnvelopeView | null
  money: (n: number) => string
  onOpenChange: (v: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const { getToken } = useAuth()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!envelope) {
      setDetail(null)
      return
    }
    let alive = true
    setLoading(true)
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const d = await apiGet<Detail>(`/api/budgets/v2/envelopes/${envelope.id}/detail`, token)
        if (alive) setDetail(d)
      } catch {
        if (alive) setDetail(null)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [envelope, getToken])

  const obligation = envelope?.section === "commitment" || envelope?.section === "debt"
  const isSavings = envelope?.section === "savings"

  return (
    <Drawer open={Boolean(envelope)} onOpenChange={(v) => (v ? undefined : onOpenChange(false))}>
      <DrawerContent className="max-h-[92dvh]">
        <div className="mx-auto w-full max-w-lg overflow-y-auto px-4 pb-4">
          <DrawerHeader className="px-0">
            <DrawerTitle>{envelope?.name ?? ""}</DrawerTitle>
            <DrawerDescription>
              {/* Section vocabulary (§8.7): only a flexible envelope has a target
                  to be over; a bill or debt is PAID or UNPAID; a fund is
                  reserved or set aside. Blurring them is the bug class the
                  design exists to remove. */}
              {!envelope
                ? ""
                : obligation
                  ? t("budgetV2.unpaidAmount", { amount: money(envelope.pending) })
                  : isSavings
                    ? envelope.contribution_status === "confirmed"
                      ? t("budgetV2.contributionConfirmed", { amount: money(envelope.planned) })
                      : t("budgetV2.contributionPlanned", { amount: money(envelope.planned) })
                    : t("budgetV2.detailSummary", {
                        planned: money(envelope.planned),
                        spent: money(envelope.spent_net),
                      })}
            </DrawerDescription>
          </DrawerHeader>

          {/* The figures the card shows, in full — in the section's own words. */}
          {envelope && obligation && (
            <dl className="grid grid-cols-3 gap-2">
              <Figure label={t("budgetV2.planned")} value={money(envelope.planned)} />
              <Figure label={t("budgetV2.paidShort")} value={money(envelope.settled ?? 0)} />
              <Figure label={t("budgetV2.unpaidLabel")} value={money(envelope.pending)} />
            </dl>
          )}
          {envelope && isSavings && (
            <dl className="grid grid-cols-3 gap-2">
              <Figure label={t("budgetV2.planned")} value={money(envelope.planned)} />
              <Figure
                label={
                  envelope.contribution_status === "confirmed"
                    ? t("budgetV2.setAsideThisPeriod")
                    : t("budgetV2.awaitingConfirmation")
                }
                value={money(envelope.planned)}
              />
              <Figure label={t("budgetV2.fundBalanceLabel")} value={money(envelope.balance ?? 0)} />
            </dl>
          )}
          {envelope && !obligation && !isSavings && (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Figure label={t("budgetV2.planned")} value={money(envelope.planned)} />
              <Figure label={t("budgetV2.spent")} value={money(envelope.spent_net)} />
              <Figure label={t("budgetV2.pending")} value={money(envelope.pending)} />
              <Figure
                label={envelope.remaining >= 0 ? t("budgetV2.remaining") : t("budgetV2.overBy")}
                value={money(Math.abs(envelope.remaining))}
                tone={envelope.remaining < 0 ? "over" : undefined}
              />
            </dl>
          )}

          {loading && (
            <div className="mt-4 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {!loading && detail && (
            <>
              {/* ── the rows behind the number ── */}
              {detail.transactions.length > 0 && (
                <section className="mt-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("budgetV2.detailTransactions")}
                  </h3>
                  <ul className="mt-2 divide-y">
                    {detail.transactions.map((tx) => (
                      <li key={tx.id} className="flex items-start justify-between gap-2 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium">
                            {tx.description || tx.category || t("budgetV2.noDescription")}
                          </p>
                          <p className="text-[11px] text-muted-foreground tabular-nums">
                            {formatIsoDate(tx.date, i18n.language)}
                            {tx.category ? ` · ${tx.category}` : ""}
                          </p>
                          {/* "This 400 was reimbursed 250, 150 still outstanding". */}
                          {tx.settlement_status && tx.settlement_status !== "unsettled" && (
                            <p className="text-[11px] text-muted-foreground">
                              {tx.settlement_status === "fully_settled"
                                ? t("budgetV2.fullySettled", { amount: money(tx.settled_amount ?? 0) })
                                : t("budgetV2.partiallySettled", {
                                    settled: money(tx.settled_amount ?? 0),
                                    outstanding: money(tx.outstanding ?? 0),
                                  })}
                            </p>
                          )}
                          {tx.is_confirmed_settlement && (
                            <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                              {t("budgetV2.confirmedSettlement")}
                            </p>
                          )}
                        </div>
                        <span
                          className={`shrink-0 text-xs font-medium tabular-nums ${
                            tx.type === "incoming" ? "text-emerald-700 dark:text-emerald-400" : ""
                          }`}
                        >
                          {tx.type === "incoming" ? "+" : "−"}
                          {money(tx.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* ── the attributed economic view (§8.8.1) ──
                  Shown ONLY when it actually differs from the cash figure, i.e.
                  when a refund crossed a period boundary. Otherwise it would be
                  a second number saying the same thing, and a screen with two
                  figures for one fact is how a budget loses its reader. */}
              {detail.attributed && detail.attributed.settlements > 0 && (
                <section className="mt-5 rounded-lg border border-dashed p-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("budgetV2.attributedTitle")}
                  </h3>
                  {/* Labelled as a report, explicitly. The figures above are the
                      operational truth; this answers a different question. */}
                  <p className="mt-1 text-[11px] text-muted-foreground">{t("budgetV2.attributedBody")}</p>
                  <dl className="mt-2 grid grid-cols-3 gap-2">
                    <div>
                      <dt className="text-[11px] text-muted-foreground">{t("budgetV2.attributedGross")}</dt>
                      <dd className="text-sm font-semibold tabular-nums">{money(detail.attributed.gross)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">{t("budgetV2.attributedRefunded")}</dt>
                      <dd className="text-sm font-semibold tabular-nums">
                        −{money(detail.attributed.settlements)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">{t("budgetV2.attributedNet")}</dt>
                      <dd className="text-sm font-semibold tabular-nums">{money(detail.attributed.net_cost)}</dd>
                    </div>
                  </dl>
                </section>
              )}

              {/* ── history across closed periods ── */}
              {detail.history.filter((h) => h.status === "closed").length > 0 && (
                <section className="mt-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("budgetV2.detailHistory")}
                  </h3>
                  <ul className="mt-2 divide-y">
                    {detail.history
                      .filter((h) => h.status === "closed")
                      .map((h) => (
                        <li key={h.period_id} className="flex items-center justify-between gap-2 py-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium tabular-nums">{h.start}</p>
                            {/* The name AS AT close — a rename must not rewrite history. */}
                            {h.name_at_close && h.name_at_close !== envelope?.name && (
                              <p className="text-[11px] text-muted-foreground">
                                {t("budgetV2.wasNamed", { name: h.name_at_close })}
                              </p>
                            )}
                            {h.restated_reason && (
                              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                                {t("budgetV2.restated")}
                              </p>
                            )}
                          </div>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {money(h.spent_net ?? 0)} / {money(h.planned)}
                          </span>
                        </li>
                      ))}
                  </ul>
                </section>
              )}

              {/* ── audit trail ── */}
              {detail.events.length > 0 && (
                <section className="mt-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("budgetV2.detailActivity")}
                  </h3>
                  <ul className="mt-2 space-y-1">
                    {detail.events.slice(0, 12).map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate text-muted-foreground">
                          {t(EVENT_KEY[e.action] ?? "budgetV2.events.other")}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {formatIsoDate(e.created_at?.slice(0, 10), i18n.language)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {detail.transactions.length === 0 && detail.history.length === 0 && (
                <p className="mt-5 text-xs text-muted-foreground">{t("budgetV2.detailEmpty")}</p>
              )}
            </>
          )}

          {!loading && !detail && envelope && (
            <p className="mt-5 text-xs text-muted-foreground">{t("budgetV2.detailFailed")}</p>
          )}
        </div>
        <DrawerFooter className="pt-0" />
      </DrawerContent>
    </Drawer>
  )
}

/**
 * Audit-trail labels, keyed statically like BudgetDetailPage's ACTION_KEY —
 * never a dynamic key with the raw identifier as fallback, which rendered
 * "envelope retargeted" in every locale.
 */
const EVENT_KEY: Record<string, string> = {
  envelope_created: "budgetV2.events.envelopeCreated",
  envelope_updated: "budgetV2.events.envelopeUpdated",
  envelope_retargeted: "budgetV2.events.envelopeRetargeted",
  envelope_removed: "budgetV2.events.envelopeRemoved",
  envelopes_reordered: "budgetV2.events.envelopesReordered",
  reallocated: "budgetV2.events.reallocated",
  covered_from_unallocated: "budgetV2.events.coveredFromUnallocated",
  commitment_created: "budgetV2.events.commitmentCreated",
  commitment_updated: "budgetV2.events.commitmentUpdated",
  commitment_cancelled: "budgetV2.events.commitmentCancelled",
  occurrence_settle: "budgetV2.events.occurrenceSettled",
  occurrence_cancel: "budgetV2.events.occurrenceCancelled",
  occurrence_skip: "budgetV2.events.occurrenceSkipped",
  occurrence_reschedule: "budgetV2.events.occurrenceRescheduled",
  fund_contributed: "budgetV2.events.fundContributed",
  fund_missed: "budgetV2.events.fundMissed",
  fund_skipped: "budgetV2.events.fundSkipped",
  fund_unskipped: "budgetV2.events.fundUnskipped",
  rollover_applied: "budgetV2.events.rolloverApplied",
  settlement_linked: "budgetV2.events.settlementLinked",
  settlement_unlinked: "budgetV2.events.settlementUnlinked",
  refund_rejected: "budgetV2.events.refundRejected",
  lifetime_choice_resolved: "budgetV2.events.lifetimeChoiceResolved",
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "over" }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd
        className={`text-sm font-semibold tabular-nums ${tone === "over" ? "text-red-600 dark:text-red-400" : ""}`}
      >
        {value}
      </dd>
    </div>
  )
}
