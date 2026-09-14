import { useEffect, useMemo, useRef, useState } from "react"

import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { ArrowDownRight, ArrowUpRight, CalendarClock, ChevronDown, HandCoins, Plus, TriangleAlert } from "lucide-react"
import { apiGet, apiPatch, apiPost } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import { useModalDraft } from "@/hooks/use-modal-draft"
import { useCurrency } from "@/lib/currency-context"
import { accountTypeAllows } from "@/lib/types"
import type { Card, Client, Debt, DebtsOverview, RecurringRule, WealthAccount } from "@/lib/types"
import { previewRecurring } from "@/lib/recurring-preview"
import { isLinkable, linkRefusal, recurringToFrequency, type LinkCandidateRule, type LinkRefusal } from "@/lib/debt-recurring"
import { previewDebt } from "@/lib/debt-preview"
import { toCents } from "@/lib/debt-math"
import { formatMoney } from "@/lib/wealth"
import { getCurrencySymbol } from "@/lib/currencies"
import { cn } from "@/lib/utils"
import { Collapse } from "@/components/Collapse"
import { DebtPreviewCard } from "@/components/debts/DebtPreviewCard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { CategoryPicker } from "@/components/CategoryPicker"
import { AccountCombobox } from "@/components/wealth/AccountCombobox"
import { appLocale } from "@/lib/format-date"

export type RuleForm = {
  name: string
  type: "incoming" | "outgoing"
  amount: string
  category: string
  client_id: string // "" = own company / personal
  wealth_account_id: string // "" = none
  card_id: string // "" = paid straight from the account
  frequency_unit: "day" | "week" | "month" | "year"
  frequency_interval: string
  start_date: string
  end_date: string
  /** "" = an ordinary payment, "new" = create one here, otherwise a debt id. */
  debt_choice: string
  debt_name: string
  /** What it started at. Drives "x% repaid" — the ONLY thing it feeds. */
  debt_original: string
  debt_balance: string
  debt_rate: string
}

/**
 * Why a payment cannot start a debt from here, in the user's terms. Only the
 * refusals this form can actually produce are named; the rest are unreachable
 * (an autosave rule is managed on its Space, a direction mismatch cannot happen
 * when the direction is derived) and simply hide the option.
 */
const NEW_DEBT_HINTS: Partial<Record<LinkRefusal, string>> = {
  rule_has_no_account: "recurring.debtNeedsAccount",
  rule_pays_with_card: "recurring.debtNotCard",
  account_archived: "recurring.debtNeedsCash",
  account_not_cash: "recurring.debtNeedsCash",
  rule_ended: "recurring.debtRuleEnded",
  rule_linked_elsewhere: "recurring.debtAlreadyLinked",
  rule_has_pending: "recurring.debtHasPending",
}

const emptyRuleForm = (): RuleForm => ({
  name: "",
  type: "outgoing",
  amount: "",
  category: "",
  client_id: "",
  wealth_account_id: "",
  card_id: "",
  frequency_unit: "month",
  frequency_interval: "1",
  start_date: new Date().toISOString().split("T")[0],
  end_date: "",
  debt_choice: "",
  debt_name: "",
  debt_original: "",
  debt_balance: "",
  debt_rate: "",
})

const formFromRule = (rule: RecurringRule): RuleForm => ({
  name: rule.name,
  type: rule.type,
  amount: String(rule.amount),
  category: rule.category,
  client_id: rule.client_id ?? "",
  wealth_account_id: rule.wealth_account_id ?? "",
  card_id: rule.card_id ?? "",
  frequency_unit: rule.frequency_unit,
  frequency_interval: String(rule.frequency_interval),
  start_date: rule.start_date,
  end_date: rule.end_date ?? "",
  debt_choice: rule.debt_account_id ?? "",
  debt_name: "",
  debt_original: "",
  debt_balance: "",
  debt_rate: "",
})

const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(appLocale(), { day: "numeric", month: "short", year: "numeric" })

/**
 * THE create/edit form for a recurring payment — shared by the list (/recurring)
 * and one rule's own page (/recurring/:id), so editing behaves identically
 * wherever it is opened from. The parent owns `open` and the rule being edited;
 * this owns the form, the schedule preview and the save.
 */
export function RecurringRuleDialog({
  open,
  onOpenChange,
  rule,
  preset,
  accounts,
  clients,
  cards,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create a new rule. */
  rule: RecurringRule | null
  /** Seed values for a create (e.g. a card page's "Add recurring"). */
  preset?: Partial<RuleForm>
  accounts: WealthAccount[]
  clients: Client[]
  /** Cards that can pay right now (`usableCards`). */
  cards: Card[]
  onSaved: (rule: RecurringRule, info: { created: boolean; createdNow?: number }) => void
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const { currency } = useCurrency()
  const hasClients = accountTypeAllows(activeOrg?.account_type ?? null, "clients")

  const [form, setForm] = useState<RuleForm>(emptyRuleForm)
  const [saving, setSaving] = useState(false)
  // Did the user actually choose "no debt"? See the debt Select's onValueChange.
  const [unlinkAsked, setUnlinkAsked] = useState(false)
  // The optional loan-document facts, closed by default.
  const [moreDebt, setMoreDebt] = useState(false)
  // Set when Save was pressed with no category; cleared the moment one is picked.
  const [categoryError, setCategoryError] = useState(false)
  // Read at open time only — a fresh object identity each render must not
  // re-seed the form while the user is typing in it.
  const presetRef = useRef(preset)
  presetRef.current = preset

  // Seed on each OPEN (the dialog stays mounted between opens): the rule's own
  // values when editing, an empty form when creating, and the preset over both
  // — a caller can open this already pointed at something ("Create a debt for
  // this" arrives here with the debt question answered). Re-arming `saving`
  // matters too: a request still in flight when the user closed it would
  // otherwise leave the save button dead on reopen.
  // `rule` is read through a ref for the same reason `preset` is: this screen
  // revalidates in the background (data-fetching-and-cache), so a fresh object
  // identity arrives while the dialog is open — and depending on it here threw
  // away everything the user had typed, mid-sentence.
  const ruleRef = useRef(rule)
  ruleRef.current = rule

  // What the form looked like the moment it was seeded. "Dirty" is measured
  // against THIS, not against emptiness — an edit arrives fully populated, and
  // calling that dirty would leave a draft shadowing the rule's real values on
  // every later open.
  const seedRef = useRef<RuleForm>(form)
  // A different rule, or a different preset, is a different intention and must
  // re-seed. Derived from the preset's CONTENT: its identity churns per render.
  const contextKey = `${rule?.id ?? "new"}:${activeOrg?.id ?? ""}:${JSON.stringify(Object.entries(preset ?? {}).sort())}`
  const dirty = JSON.stringify(form) !== JSON.stringify(seedRef.current) || unlinkAsked
  const draft = useModalDraft({ open, dirty, contextKey })

  useEffect(() => {
    if (!open) return
    // ALWAYS, outside the seed branch: a save still in flight when the user
    // dismissed would otherwise leave both footer buttons disabled forever.
    setSaving(false)
    // A dismissal — Escape, the overlay, the X, the Back gesture — keeps what
    // was typed. Only an explicit Cancel or a successful save clears it.
    if (!draft.shouldSeed()) return
    const seedFrom = ruleRef.current
    const seeded = { ...(seedFrom ? formFromRule(seedFrom) : emptyRuleForm()), ...presetRef.current }
    const next = seeded.debt_choice === "new" && !seeded.debt_name ? { ...seeded, debt_name: seeded.name } : seeded
    seedRef.current = next
    setForm(next)
    setUnlinkAsked(false)
    setMoreDebt(false)
    setCategoryError(false)
    // `open` ONLY — see ruleRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // The debts this payment could be attached to. Loaded once per open; the
  // eligibility predicate is the SAME one the server enforces, so nothing is
  // offered that would be refused on save.
  const [debts, setDebts] = useState<Debt[] | null>(null)
  useEffect(() => {
    if (!open) return
    setDebts(null)
    let cancelled = false
    ;(async () => {
      const token = await getToken()
      if (!token) return
      const o = await apiGet<DebtsOverview>("/api/debts", token).catch(() => null)
      // A FAILED fetch must stay null, not become "no debts". The clearing
      // effect below treats an empty list as "the debt you had is gone" and
      // drops the link — so collapsing the two turned an offline blink into a
      // silent unlink on the next save.
      if (!cancelled && o) setDebts([...o.debts, ...o.receivables])
    })()
    return () => { cancelled = true }
  }, [open, getToken])

  const interval = Math.max(1, Math.floor(Number(form.frequency_interval) || 1))
  const today = new Date().toISOString().split("T")[0]
  const symbol = getCurrencySymbol(currency)
  const incoming = form.type === "incoming"

  const candidate: LinkCandidateRule = useMemo(() => ({
    id: rule?.id ?? "new",
    kind: "standard",
    type: form.type,
    cardId: form.card_id || null,
    accountId: form.wealth_account_id || null,
    accountType: accounts.find((a) => a.id === form.wealth_account_id)?.type ?? null,
    accountArchived: false,
    accountCurrency: accounts.find((a) => a.id === form.wealth_account_id)?.currency_code ?? null,
    // The debt it ALREADY repays: a rule services one debt, so while it has
    // one, no other debt — and no new one — may be offered here. Unlinking is
    // a deliberate step on its own page.
    debtAccountId: rule?.debt_account_id ?? null,
    ended: !!form.end_date && form.end_date < today,
    // From the STORED rule, not the form: an occurrence that is already due has
    // to post in the shape it was owed in, and no edit in this dialog changes
    // whether that is true.
    hasPending: !!rule && rule.active && String(rule.next_due_at).slice(0, 10) <= today,
  }), [rule, form.type, form.card_id, form.wealth_account_id, form.end_date, today, accounts])

  const eligibleDebts = useMemo(
    () => (debts ?? []).filter((d) => isLinkable(candidate, {
      id: d.id,
      direction: d.direction,
      archived: !!d.archived_at,
      currency: d.currency,
      // A PAUSED rule counts too, so a debt that already has one is not offered.
      lifecycle: d.lifecycle,
      linkedRuleIds: (d.repayment_linked ?? d.repayment_active) ? (rule?.debt_account_id === d.id ? [rule.id] : ["other"]) : [],
    })),
    [debts, candidate, rule?.id, rule?.debt_account_id],
  )

  const creatingDebt = form.debt_choice === "new"
  const linkedDebt = creatingDebt ? null : (debts ?? []).find((d) => d.id === form.debt_choice) ?? null
  const withDebt = creatingDebt || !!linkedDebt

  // A repayment's direction decides which side of the debt it is: money going
  // out pays something you owe, money coming in collects something owed to you.
  // Deriving it removes the whole class of "the rule and the debt disagree".
  const newDebtDirection = incoming ? "receivable" : "owed"

  // Can this payment take on a debt that does not exist yet? Exactly the
  // server's own test (api/_lib/recurring-debt.ts refusalForNew): the same
  // predicate against the same synthetic debt. Deriving the direction from the
  // rule makes a mismatch impossible, so what is left is the payer's shape —
  // no account, a card, a credit line — and the rule's own life.
  const createRefusal: LinkRefusal | null = useMemo(
    () => linkRefusal(candidate, { id: "new", direction: newDebtDirection, archived: false, lifecycle: "active", linkedRuleIds: [] }),
    [candidate, newDebtDirection],
  )
  const createHintKey = createRefusal ? NEW_DEBT_HINTS[createRefusal] : null

  // The payer can stop being able to service a debt AFTER one was chosen —
  // switch to a card, clear the account, flip the direction. Dropping the
  // choice keeps the form honest instead of letting it claim a repayment the
  // save would refuse. Wait for the debts to load: an edit seeds its own link
  // before the list arrives, and clearing it then would silently unlink.
  useEffect(() => {
    if (debts === null) return
    setForm((f) => {
      if (!f.debt_choice) return f
      if (f.debt_choice === "new") return createRefusal ? { ...f, debt_choice: "" } : f
      return eligibleDebts.some((d) => d.id === f.debt_choice) ? f : { ...f, debt_choice: "" }
    })
  }, [debts, createRefusal, eligibleDebts])

  // Live preview: the debt's whole story when one is involved, the schedule and
  // what it costs a year otherwise.
  // Where the NEXT payment actually comes from, mirroring what the server will
  // do on save: an untouched schedule keeps the rule's cursor, a changed one is
  // re-anchored forward to today, and a rule being created starts at its anchor
  // (the documented catch-up). Without this the preview listed dates from a
  // year ago under the heading "Next payments".
  const previewFrom = useMemo(() => {
    if (!rule) return null
    const changed = form.start_date !== String(rule.start_date).slice(0, 10)
      || form.frequency_unit !== rule.frequency_unit
      || interval !== rule.frequency_interval
    return changed ? today : String(rule.next_due_at).slice(0, 10)
  }, [rule, form.start_date, form.frequency_unit, interval, today])

  const schedulePreview = useMemo(
    () => previewRecurring({
      amount: Number(form.amount) || 0,
      unit: form.frequency_unit,
      interval,
      startDate: form.start_date,
      endDate: form.end_date || null,
      today,
      from: previewFrom,
    }),
    [form.amount, form.frequency_unit, interval, form.start_date, form.end_date, today, previewFrom],
  )

  const debtPreview = useMemo(() => {
    if (!withDebt) return null
    const owed = creatingDebt ? Number(form.debt_balance) || 0 : linkedDebt?.balance ?? 0
    const rate = creatingDebt
      ? (form.debt_rate.trim() !== "" && Number.isFinite(Number(form.debt_rate)) ? Number(form.debt_rate) : null)
      : linkedDebt?.annual_rate_pct ?? null
    // Null for a rhythm the debt vocabulary cannot name (every 10 days); the
    // preview then has no periods to amortise over and stands down.
    const frequency = recurringToFrequency(form.frequency_unit, interval)
    const scheduled = frequency && frequency !== "irregular" ? frequency : null
    const first = form.start_date > today ? form.start_date : today
    return previewDebt({
      owed: toCents(owed),
      // The real original when one was typed, otherwise NOTHING. Passing the
      // remaining balance made previewDebt print "0 % repaid so far." about a
      // debt that does not exist yet.
      original: creatingDebt
        ? (form.debt_original.trim() !== "" && Number.isFinite(Number(form.debt_original)) ? toCents(Number(form.debt_original)) : null)
        : linkedDebt?.original_amount == null ? null : toCents(linkedDebt.original_amount),
      annualRatePct: rate,
      repayment: scheduled && Number(form.amount) > 0 && form.start_date
        ? { amount: toCents(Number(form.amount)), frequency: scheduled, firstPayment: first }
        : null,
    })
  }, [withDebt, creatingDebt, linkedDebt, form.debt_balance, form.debt_original, form.debt_rate, form.amount, form.frequency_unit, interval, form.start_date, today])

  /**
   * Four shapes, and every one of them is ONE request, because every one of
   * them is one intention:
   *
   *   new rule, no debt          POST /api/recurring
   *   new rule + existing debt   POST /api/recurring { debt_account_id }
   *   new debt (either case)     POST /api/debts { repayment } / { link_rule_id }
   *   existing rule              PATCH /api/recurring/:id, link separately
   *
   * Creating a debt and then attaching it would leave a debt nobody pays, or a
   * plain expense, if the second request never landed.
   */
  async function handleSave() {
    if (!form.name.trim()) { toast.error(t("recurring.nameRequired")); return }
    if (!(Number(form.amount) > 0)) { toast.error(t("recurring.amountRequired")); return }
    // A recurring rule stamps its category onto every occurrence it will ever
    // post, so a blank one is not one uncategorised row — it is a standing
    // order's worth. A blank category is also unreachable by every
    // category-scoped budget, so the money lands nowhere anyone can plan
    // against. Only asked for when the picker is on screen: a repayment's
    // category is the engine's.
    if (!withDebt && !form.category.trim()) {
      setCategoryError(true)
      toast.error(t("recurring.categoryRequired"))
      return
    }
    if (creatingDebt) {
      if (!form.debt_name.trim()) { toast.error(t("recurring.debtNameRequired")); return }
      if (!(Number(form.debt_balance) >= 0) || form.debt_balance.trim() === "") { toast.error(t("recurring.debtBalanceRequired")); return }
    }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const frequency_interval = Math.max(1, Math.floor(Number(form.frequency_interval) || 1))
      const body = {
        name: form.name.trim(),
        type: form.type,
        amount: Number(form.amount),
        // A debt repayment's category and client are the engine's, not the
        // form's; the server forces them too, this just stops sending noise.
        // On the create-a-debt path they are OMITTED rather than blanked — the
        // debt route sets them a moment later, and if it fails the rule keeps
        // what it had instead of being left uncategorised with its client gone.
        ...(creatingDebt && rule
          ? {}
          : { category: withDebt ? "" : form.category, client_id: withDebt ? null : form.client_id || null }),
        // The card decides the account server-side (it is always the card's own).
        wealth_account_id: form.wealth_account_id || null,
        card_id: form.card_id || null,
        frequency_unit: form.frequency_unit,
        frequency_interval,
        start_date: form.start_date,
        end_date: form.end_date || null,
      }

      // Creating the debt here: the debt route owns the write, and it carries
      // the rule with it — a new one in `repayment`, an existing one by id.
      if (creatingDebt) {
        // An EDIT goes first, and this is not a preference. The debt route
        // validates the rule AS STORED, so a save that changes the payer or the
        // direction AND creates a debt would be judged on the old values and
        // refused. Going first also means a rejected edit has created nothing:
        // the alternative leaves a debt the user cannot see a way to undo.
        let edited: RecurringRule | null = null
        if (rule) edited = await apiPatch<RecurringRule>(`/api/recurring/${rule.id}`, token, body)
        const debtBody = {
          direction: newDebtDirection,
          name: form.debt_name.trim(),
          current_balance: Number(form.debt_balance),
          // What it started at, when it is known. The route defaults a missing
          // original to the balance, so sending the balance twice was the same
          // as saying "nothing has ever been repaid on this" — every debt made
          // here was born at 0% against a figure that was not its original.
          original_amount: form.debt_original.trim() === "" ? Number(form.debt_balance) : Number(form.debt_original),
          annual_rate_pct: form.debt_rate.trim() === "" ? null : Number(form.debt_rate),
          // Born in the paying account's currency: a repayment moves one amount
          // on both sides, so the debt can only be in the currency it is paid in.
          ...(candidate.accountCurrency ? { currency: candidate.accountCurrency } : {}),
          ...(rule
            ? { link_rule_id: rule.id }
            : {
                repayment: {
                  enabled: true,
                  from_account_id: form.wealth_account_id,
                  amount: Number(form.amount),
                  // The RULE's rhythm, not a debt word. The debt vocabulary names
                  // five rhythms; a rule can repeat on any of 365 intervals, and
                  // naming the nearest one turned "every 2 years" into "monthly".
                  frequency_unit: form.frequency_unit,
                  frequency_interval,
                  start_date: form.start_date,
                  end_date: form.end_date || null,
                  name: form.name.trim(),
                },
              }),
        }
        const saved = await apiPost<{ id: string; repayment_rule_id?: string | null }>("/api/debts", token, debtBody)
        // One success, said once, after everything has actually landed.
        toast.success(t("recurring.debtCreatedAndLinked"))
        if (rule) onSaved(edited ?? rule, { created: false })
        else onSaved({ ...(body as unknown as RecurringRule), id: saved.repayment_rule_id ?? "" }, { created: true })
        draft.clearDraft()
        onOpenChange(false)
        return
      }

      if (rule) {
        const updated = await apiPatch<RecurringRule>(`/api/recurring/${rule.id}`, token, body)
        // Attaching or detaching is its own request by design: it cannot be
        // atomic alongside an edit, so the server refuses the combination.
        const want = form.debt_choice || null
        const have = rule.debt_account_id ?? null
        // Detaching needs both: the field changed AND the user said so. An
        // empty field on its own is ambiguous — see unlinkAsked.
        const change = want !== have && (want !== null || unlinkAsked)
        const linked = change
          ? await apiPatch<RecurringRule>(`/api/recurring/${rule.id}`, token, { debt_account_id: want })
          : updated
        toast.success(t("recurring.updated"))
        onSaved(linked, { created: false })
      } else {
        const created = await apiPost<RecurringRule & { created_now?: number }>("/api/recurring", token, {
          ...body,
          ...(form.debt_choice ? { debt_account_id: form.debt_choice } : {}),
        })
        toast.success(
          created.created_now
            ? t("recurring.createdWithTx", { count: created.created_now })
            : t("recurring.created"),
        )
        onSaved(created, { created: true, createdNow: created.created_now })
      }
      draft.clearDraft()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("recurring.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl">
        <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6">
          <DialogTitle>{rule ? t("recurring.editTitle") : t("recurring.addTitle")}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-6 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="rec-name">{t("recurring.name")}</Label>
            <Input id="rec-name" value={form.name} maxLength={120} placeholder={t("recurring.namePlaceholder")} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
          </div>

          {/* Which way the money goes, in the add-transaction colour language:
              leaving is red, arriving is green. It decides the account label,
              the categories offered and which side of a debt this can pay, so
              it earns a full row rather than a dropdown. */}
          <div className="space-y-1.5">
            <Label>{t("recurring.direction")}</Label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("recurring.direction")}>
              {([
                { v: "outgoing", label: t("recurring.outgoing"), Icon: ArrowDownRight, on: "border-red-500 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 dark:border-red-600" },
                { v: "incoming", label: t("recurring.incoming"), Icon: ArrowUpRight, on: "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-600" },
              ] as const).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  role="radio"
                  aria-checked={form.type === o.v}
                  onClick={() => setForm((f) => ({
                    ...f,
                    type: o.v,
                    // The categories differ per direction, and a debt chosen for
                    // the other side would now be the wrong one.
                    category: "",
                    debt_choice: f.debt_choice === "new" ? "new" : "",
                  }))}
                  className={cn(
                    "flex min-h-11 items-center justify-center gap-1.5 rounded-md border px-2 py-2.5 text-sm font-medium transition-colors",
                    form.type === o.v ? o.on : "border-border hover:bg-muted",
                  )}
                >
                  <o.Icon className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{o.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rec-amount">{t("recurring.amount")}</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground">{symbol}</span>
              <Input id="rec-amount" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={form.amount} className="h-12 pl-9 text-lg font-semibold tabular-nums" onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("recurring.repeats")}</Label>
              <Select value={form.frequency_unit} onValueChange={(v) => setForm((f) => ({ ...f, frequency_unit: v as RuleForm["frequency_unit"] }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">{t("recurring.daily")}</SelectItem>
                  <SelectItem value="week">{t("recurring.weekly")}</SelectItem>
                  <SelectItem value="month">{t("recurring.monthly")}</SelectItem>
                  <SelectItem value="year">{t("recurring.yearly")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-interval">{t("recurring.every")}</Label>
              <Input id="rec-interval" type="number" inputMode="numeric" min="1" max="365" step="1" value={form.frequency_interval} onChange={(e) => setForm((f) => ({ ...f, frequency_interval: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rec-start">{t("recurring.startsOn")}</Label>
              <Input id="rec-start" type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-end">{t("recurring.endsOn")}</Label>
              <Input id="rec-end" type="date" value={form.end_date} min={form.start_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
            </div>
          </div>
          <p className="-mt-2 text-[11px] text-muted-foreground">{t("recurring.endsOnHint")}</p>

          <div className="space-y-1.5">
            {/* "Pay with" is only true one way round. Money arriving lands
                somewhere; it is not paid with anything. */}
            <Label>{incoming ? t("recurring.comesInto") : t("recurring.cardPayWith")}</Label>
            {/* Accounts AND cards: picking a card also sets its account (the
                server enforces the pair — a card only ever pays from its own). */}
            <AccountCombobox
              accounts={accounts}
              cards={cards}
              value={form.card_id || form.wealth_account_id}
              onChange={(id, picked) => setForm((f) => ({ ...f, wealth_account_id: picked ? picked.account_id : id, card_id: picked?.card_id ?? "" }))}
              currency={currency}
              allowNone
              noneLabel={t("recurring.noAccount")}
            />
            <p className="text-[11px] text-muted-foreground">{incoming ? t("recurring.comesIntoHint") : t("recurring.cardPayWithHint")}</p>
          </div>

          {/* Does this pay a debt? The standing order is usually older than the
              debt, and the debt often does not exist here at all — so both
              joining an existing one and making one are the same question. */}
          <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
            <Label htmlFor="rec-debt">{incoming ? t("recurring.collectsDebtQ") : t("recurring.paysDebtQ")}</Label>
            <Select
              value={form.debt_choice || "none"}
              onValueChange={(v) => {
                // Only a deliberate "no" detaches a live repayment. Everything
                // else that empties this field — a failed fetch, an archived
                // account, a debt that stopped being eligible — is the form
                // losing track, not the user changing their mind.
                if (v === "none") setUnlinkAsked(true)
                setForm((f) => ({
                  ...f,
                  debt_choice: v === "none" ? "" : v,
                  debt_name: v === "new" && !f.debt_name ? f.name : f.debt_name,
                }))
              }}
            >
              <SelectTrigger id="rec-debt" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("recurring.noDebt")}</SelectItem>
                {/* Offered only while the save would accept it — see createRefusal. */}
                {!createRefusal && <SelectItem value="new">{t("recurring.createDebt")}</SelectItem>}
                {eligibleDebts.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name} · {formatMoney(d.balance, d.currency, true)}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {linkedDebt && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <HandCoins className="size-3.5 shrink-0" aria-hidden /> {t("recurring.debtLinkForwardOnly")}
              </p>
            )}

            <Collapse open={creatingDebt}>
              <div className="space-y-3 pt-1">
                <div className="space-y-1.5">
                  <Label htmlFor="rec-debt-name">{incoming ? t("recurring.debtWhoOwes") : t("recurring.debtWhoOwed")}</Label>
                  <Input id="rec-debt-name" value={form.debt_name} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, debt_name: e.target.value }))} />
                </div>
                {/* The two amounts, in the debt sheet's order and vocabulary:
                    what it started at, and what is left. Only the second is
                    required — the first exists so "40% repaid" can be true
                    rather than every debt made here starting life at zero. */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-debt-original">{t("debts.originalAmount")}</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">{symbol}</span>
                      <Input id="rec-debt-original" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={form.debt_original} className="pl-7 tabular-nums" onChange={(e) => setForm((f) => ({ ...f, debt_original: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-debt-balance">{incoming ? t("debts.howMuchOwed") : t("debts.howMuchLeft")}</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">{symbol}</span>
                      <Input id="rec-debt-balance" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={form.debt_balance} className="pl-7 tabular-nums" onChange={(e) => setForm((f) => ({ ...f, debt_balance: e.target.value }))} />
                    </div>
                  </div>
                </div>

                {/* The rate is a loan-document fact people rarely have to hand,
                    and it is optional. Behind a closed disclosure, labelled with
                    what it actually is — "Rate (%)" did not say per what, or of
                    what. Same pattern and same words as the debt sheet. */}
                <div className="rounded-xl border">
                  <button
                    type="button"
                    onClick={() => setMoreDebt((v) => !v)}
                    aria-expanded={moreDebt}
                    className="flex min-h-11 w-full items-center justify-between px-3 text-sm font-medium"
                  >
                    {t("debts.moreDetails")}
                    <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-200", moreDebt && "rotate-180")} aria-hidden />
                  </button>
                  <Collapse open={moreDebt}>
                    <div className="space-y-1.5 border-t px-3 py-3">
                      <Label htmlFor="rec-debt-rate">{t("debts.interestRate")}</Label>
                      <Input id="rec-debt-rate" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={form.debt_rate} onChange={(e) => setForm((f) => ({ ...f, debt_rate: e.target.value }))} />
                      <p className="text-xs text-muted-foreground">{t("debts.rateNoneHelp")} {t("debts.rateHelp")}</p>
                    </div>
                  </Collapse>
                </div>

                <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <Plus className="mt-0.5 size-3 shrink-0" aria-hidden />
                  {t(newDebtDirection === "receivable" ? "recurring.debtWillBeReceivable" : "recurring.debtWillBeLoan")}
                </p>
              </div>
            </Collapse>

            {/* Say WHY there is nothing to pick. "No debt fits" is only the
                truth once the payment could service one at all; before that the
                real answer is the account, the card or the end date. */}
            {!withDebt && debts !== null && (createRefusal
              ? createHintKey && <p className="text-[11px] text-muted-foreground">{t(createHintKey)}</p>
              : eligibleDebts.length === 0 && <p className="text-[11px] text-muted-foreground">{t("recurring.noEligibleDebts")}</p>
            )}
          </div>

          {/* Category and client belong to an ordinary payment. A repayment's
              are the engine's: "Transfer", and the workspace's own client. */}
          {!withDebt && (
            <div className="space-y-1.5">
              <Label>{t("recurring.category")}</Label>
              <CategoryPicker
                type={form.type}
                value={form.category}
                invalid={categoryError}
                onChange={(name) => { if (name.trim()) setCategoryError(false); setForm((f) => ({ ...f, category: name })) }}
              />
              {categoryError && <p className="text-[11px] text-destructive">{t("recurring.categoryRequired")}</p>}
            </div>
          )}

          {hasClients && !withDebt && (
            <div className="space-y-1.5">
              <Label>{t("recurring.client")}</Label>
              <Select value={form.client_id || "own"} onValueChange={(v) => setForm((f) => ({ ...f, client_id: v === "own" ? "" : v }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="own">{t("recurring.ownCompany")}</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* What all of it adds up to. With a debt that is the payoff date and
              the interest; without one it is the schedule and the annual cost,
              which is the figure nobody works out in their head. */}
          {withDebt && debtPreview ? (
            <DebtPreviewCard
              preview={debtPreview}
              currency={currency}
              receivable={incoming}
              frequencyWord={t(`recurring.unitWord.${form.frequency_unit}`)}
              arriving={null}
            />
          ) : schedulePreview.kind === "schedule" && (
            <div className="space-y-1.5 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                <CalendarClock className="size-3.5" aria-hidden /> {t("recurring.previewTitle")}
              </p>
              {schedulePreview.neverRuns ? (
                <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-300">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t("recurring.previewNeverRuns")}
                </p>
              ) : (
                <>
                  <p className="text-sm">{schedulePreview.dates.map(fmtDate).join(" · ")}{schedulePreview.more ? " …" : ""}</p>
                  {schedulePreview.perYear > 0 && (
                    <p className="text-sm font-medium tabular-nums">
                      {t("recurring.previewPerYear", { amount: formatMoney(schedulePreview.perYear, currency, true) })}
                    </p>
                  )}
                </>
              )}
              {!rule && schedulePreview.backdated && (
                <p className="text-[11px] text-muted-foreground">{t("recurring.backdatedHint")}</p>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
          {/* Cancel is a decision, so it throws the draft away. Escape, the
              overlay and the Back gesture are accidents, so they keep it. */}
          <Button variant="outline" onClick={() => { draft.clearDraft(); onOpenChange(false) }} disabled={saving}>{t("common.cancel")}</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? t("common.saving") : rule ? t("common.save") : t("recurring.add")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Delete confirmation for one rule. Deleting stops the schedule; the payments it
 * already created are kept (see the DELETE handler) — the copy says so.
 */
export function DeleteRecurringDialog({
  rule,
  onOpenChange,
  onConfirm,
}: {
  /** The rule pending deletion, or null when nothing is. */
  rule: RecurringRule | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  return (
    <AlertDialog open={rule !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("recurring.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("recurring.deleteBody", { name: rule?.name ?? "" })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>{t("recurring.delete")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
