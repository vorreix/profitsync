import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Loader as Loader2 } from "lucide-react"
import { apiGet, apiPost } from "@/lib/api"
import { useCurrency } from "@/lib/currency-context"
import { currencySymbol } from "@/lib/wealth"
import type { BudgetEnvelopeView } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Rule = {
  id: string
  name: string
  amount: string
  type: string
  kind: string
  active: boolean
  frequency_unit: string
  frequency_interval: number
  next_due_at: string
}

/**
 * Add a bill or debt payment to a commitment/debt envelope (spec §6.7).
 *
 * Two shapes, and the difference is real:
 *
 *  - ONE-TIME is a pure budget expectation with a due date. It never ages out of
 *    the projection however overdue it becomes (decision D-17), because a bill
 *    you forgot is exactly the one you most need shown.
 *  - RECURRING LINKS one of the workspace's existing recurring expenses. It does
 *    not create a schedule: the recurring rule is what actually posts the money,
 *    and sync auto-settles the occurrence when it does. A budget-owned copy of
 *    the schedule would drift from the rule that moves the money.
 */
export function AddCommitmentDialog({
  open,
  onOpenChange,
  envelopes,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** The commitment and debt envelopes a bill may be filed under. */
  envelopes: BudgetEnvelopeView[]
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const symbol = currencySymbol(currency)

  const [kind, setKind] = useState<"one_time" | "recurring">("one_time")
  const [envelopeId, setEnvelopeId] = useState("")
  const [name, setName] = useState("")
  const [amount, setAmount] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [ruleId, setRuleId] = useState("")
  const [rules, setRules] = useState<Rule[]>([])
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setKind("one_time")
    setName("")
    setAmount("")
    setDueDate("")
    setRuleId("")
    setProblem(null)
    setEnvelopeId(envelopes[0]?.id ?? "")
    let alive = true
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const res = await apiGet<Rule[] | { rules: Rule[] }>("/api/recurring", token)
        const list = Array.isArray(res) ? res : (res?.rules ?? [])
        // Only a recurring EXPENSE can be a bill: a transfer moves money between
        // the user's own accounts and is neither a bill nor a debt payment.
        if (alive) setRules(list.filter((r) => r.type === "outgoing" && r.kind === "standard"))
      } catch {
        if (alive) setRules([])
      }
    })()
    return () => {
      alive = false
    }
  }, [open, envelopes, getToken])

  const amountNum = Number(amount)
  const canSave =
    Boolean(envelopeId) &&
    !saving &&
    (kind === "recurring"
      ? Boolean(ruleId)
      : name.trim().length > 0 && Number.isFinite(amountNum) && amountNum > 0 && Boolean(dueDate))

  const submit = async () => {
    setSaving(true)
    setProblem(null)
    try {
      const token = await getToken()
      if (!token) return
      await apiPost(
        "/api/budgets/v2/commitments",
        token,
        kind === "recurring"
          ? { envelope_id: envelopeId, kind: "recurring", recurring_rule_id: ruleId }
          : {
              envelope_id: envelopeId,
              kind: "one_time",
              name: name.trim(),
              amount: amountNum,
              due_date: dueDate,
            },
        ["/api/budgets"],
      )
      toast.success(t("budgetV2.billAdded"))
      onOpenChange(false)
      onCreated()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : t("budgetV2.billAddFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("budgetV2.addBillTitle")}</DialogTitle>
          <DialogDescription>{t("budgetV2.addBillBody")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Which kind — one decision, two clearly different meanings. */}
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("budgetV2.billKind")}>
            {(
              [
                ["one_time", t("budgetV2.billOneTime"), t("budgetV2.billOneTimeHint")],
                ["recurring", t("budgetV2.billRecurring"), t("budgetV2.billRecurringHint")],
              ] as ["one_time" | "recurring", string, string][]
            ).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                onClick={() => setKind(value)}
                className={`pressable flex min-h-16 flex-col items-start justify-center gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                  kind === value ? "border-primary bg-primary/5" : "hover:bg-accent"
                }`}
              >
                <span className="text-sm font-medium">{label}</span>
                <span className="text-[11px] text-muted-foreground">{hint}</span>
              </button>
            ))}
          </div>

          {envelopes.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="bill-env">{t("budgetV2.billEnvelope")}</Label>
              <select
                id="bill-env"
                value={envelopeId}
                onChange={(e) => setEnvelopeId(e.target.value)}
                className="h-11 w-full rounded-md border bg-background px-3 text-base"
              >
                {envelopes.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {kind === "one_time" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="bill-name">{t("budgetV2.billName")}</Label>
                <Input
                  id="bill-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  className="h-11 text-base"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="bill-amount">{t("budgetV2.billAmount")}</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      {symbol}
                    </span>
                    <Input
                      id="bill-amount"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="h-11 pl-8 text-base"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bill-due">{t("budgetV2.billDue")}</Label>
                  <Input
                    id="bill-due"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="h-11 text-base"
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="bill-rule">{t("budgetV2.billPickRecurring")}</Label>
              {rules.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("budgetV2.noRecurringExpenses")}</p>
              ) : (
                <select
                  id="bill-rule"
                  value={ruleId}
                  onChange={(e) => setRuleId(e.target.value)}
                  className="h-11 w-full rounded-md border bg-background px-3 text-base"
                >
                  <option value="">{t("budgetV2.selectOne")}</option>
                  {rules.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · {symbol}
                      {r.amount}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-xs text-muted-foreground">{t("budgetV2.billRecurringNote")}</p>
            </div>
          )}

          {problem && (
            <p role="alert" className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {problem}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSave} className="min-h-11">
            {saving ? <Loader2 className="size-4 animate-spin" /> : t("budgetV2.billAdd")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
