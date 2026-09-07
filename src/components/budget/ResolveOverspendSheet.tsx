import { useMemo, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowRight, Loader as Loader2, PiggyBank, TrendingUp } from "lucide-react"
import { apiPatch, apiPost } from "@/lib/api"
import { useCurrency } from "@/lib/currency-context"
import { currencySymbol } from "@/lib/wealth"
import { overspendOptions, round2 } from "@/lib/budget-math"
import type { BudgetEnvelopeView } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"

/**
 * Resolve an overspend (spec §6.11, §8.10).
 *
 * An overspend is a fact, not a failure. The sheet states it plainly, offers the
 * options in order of cost to the plan — move money from an envelope that has
 * room, then the unallocated buffer, then raise the target — and always allows
 * simply accepting it. Accepting is a valid plan state and is never styled as
 * the wrong answer (principle P7).
 *
 * The ORDER comes from `overspendOptions()` in the pure math layer, so the
 * advice is the same everywhere and is unit-tested.
 */
export function ResolveOverspendSheet({
  envelope,
  siblings,
  unallocated,
  money,
  onOpenChange,
  onResolved,
}: {
  envelope: BudgetEnvelopeView | null
  /** Other envelopes in the SAME section, with their own remaining room. */
  siblings: BudgetEnvelopeView[]
  unallocated: number
  money: (n: number) => string
  onOpenChange: (v: boolean) => void
  onResolved: () => void
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const symbol = currencySymbol(currency)

  const [amount, setAmount] = useState("")
  const [busy, setBusy] = useState<string | null>(null)

  const overBy = envelope ? round2(-Math.min(0, envelope.remaining)) : 0

  const options = useMemo(
    () =>
      envelope
        ? overspendOptions({
            overBy,
            unallocated,
            siblings: siblings
              .filter((s) => s.id !== envelope.id)
              .map((s) => ({ id: s.id, name: s.name, available: Math.max(0, s.remaining) })),
          })
        : [],
    [envelope, overBy, unallocated, siblings],
  )

  // Default the amount to exactly what is needed: the common case is one tap.
  const value = amount === "" ? String(overBy) : amount
  const asNumber = Number(value)
  const amountOk = Number.isFinite(asNumber) && asNumber > 0

  const close = () => {
    setAmount("")
    setBusy(null)
    onOpenChange(false)
  }

  const reallocate = async (fromId: string | null, label: string) => {
    if (!envelope || !amountOk) return
    setBusy(label)
    try {
      const token = await getToken()
      if (!token) return
      await apiPost(
        "/api/budgets/v2/reallocate",
        token,
        { ...(fromId ? { from_envelope_id: fromId } : {}), to_envelope_id: envelope.id, amount: asNumber },
      )
      toast.success(t("budgetV2.overspendResolved", { name: envelope.name }))
      onResolved()
      close()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("budgetV2.reallocateFailed"))
      setBusy(null)
    }
  }

  const raiseTarget = async () => {
    if (!envelope || !amountOk) return
    setBusy("raise")
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch(
        `/api/budgets/v2/envelopes/${envelope.id}`,
        token,
        { target_amount: round2(envelope.authored_amount + asNumber) },
      )
      toast.success(t("budgetV2.targetRaised", { name: envelope.name }))
      onResolved()
      close()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("budgetV2.retargetFailed"))
      setBusy(null)
    }
  }

  return (
    <Drawer open={Boolean(envelope)} onOpenChange={(v) => (v ? undefined : close())}>
      <DrawerContent className="max-h-[92dvh]">
        <div className="mx-auto w-full max-w-md overflow-y-auto px-4 pb-2">
          <DrawerHeader className="px-0">
            <DrawerTitle>{t("budgetV2.overspendTitle", { name: envelope?.name ?? "" })}</DrawerTitle>
            {/* States the fact, offers the options, does not scold. */}
            <DrawerDescription>
              {t("budgetV2.overspendBody", {
                amount: money(overBy),
                planned: money(envelope?.planned ?? 0),
                spent: money(envelope?.spent_net ?? 0),
              })}
            </DrawerDescription>
          </DrawerHeader>

          <div className="space-y-1.5">
            <Label htmlFor="ov-amount">{t("budgetV2.amountToMove")}</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                {symbol}
              </span>
              <Input
                id="ov-amount"
                inputMode="decimal"
                value={value}
                onChange={(e) => setAmount(e.target.value)}
                className="h-11 pl-8 text-base"
              />
            </div>
          </div>

          <ul className="mt-4 space-y-2">
            {options.map((o) => {
              if (o.kind === "move_from_envelope") {
                const working = busy === `move:${o.envelopeId}`
                return (
                  <li key={`move:${o.envelopeId}`}>
                    <button
                      type="button"
                      disabled={Boolean(busy) || !amountOk || asNumber > o.available}
                      onClick={() => reallocate(o.envelopeId, `move:${o.envelopeId}`)}
                      className="pressable flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:bg-accent disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {t("budgetV2.moveFrom", { name: o.envelopeName })}
                        </span>
                        <span className="block text-xs text-muted-foreground tabular-nums">
                          {t("budgetV2.hasAvailable", { amount: money(o.available) })}
                        </span>
                      </span>
                      {working ? (
                        <Loader2 className="size-4 shrink-0 animate-spin" />
                      ) : (
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
                      )}
                    </button>
                  </li>
                )
              }
              if (o.kind === "cover_from_unallocated") {
                const working = busy === "unallocated"
                return (
                  <li key="unallocated">
                    <button
                      type="button"
                      disabled={Boolean(busy) || !amountOk || asNumber > o.available}
                      onClick={() => reallocate(null, "unallocated")}
                      className="pressable flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:bg-accent disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <PiggyBank className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          {t("budgetV2.coverFromUnallocated")}
                        </span>
                        <span className="block text-xs text-muted-foreground tabular-nums">
                          {t("budgetV2.hasAvailable", { amount: money(o.available) })}
                        </span>
                      </span>
                      {working ? (
                        <Loader2 className="size-4 shrink-0 animate-spin" />
                      ) : (
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
                      )}
                    </button>
                  </li>
                )
              }
              if (o.kind === "raise_target") {
                const working = busy === "raise"
                return (
                  <li key="raise">
                    <button
                      type="button"
                      disabled={Boolean(busy) || !amountOk}
                      onClick={raiseTarget}
                      className="pressable flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:bg-accent disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <TrendingUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          {t("budgetV2.raiseTarget")}
                        </span>
                        <span className="block text-xs text-muted-foreground">{t("budgetV2.raiseTargetHint")}</span>
                      </span>
                      {working ? (
                        <Loader2 className="size-4 shrink-0 animate-spin" />
                      ) : (
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
                      )}
                    </button>
                  </li>
                )
              }
              // Accept — always present, never framed as the wrong answer.
              return (
                <li key="accept">
                  <Button variant="ghost" className="min-h-11 w-full" onClick={close} disabled={Boolean(busy)}>
                    {t("budgetV2.acceptOverspend")}
                  </Button>
                </li>
              )
            })}
          </ul>
        </div>
        <DrawerFooter className="pt-0" />
      </DrawerContent>
    </Drawer>
  )
}
