import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth, useUser } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowLeft, ArrowRight, Check, Crown, Loader as Loader2, Sparkles } from "lucide-react"
import { apiErrorMessage, apiGet, apiPatch, apiPost } from "@/lib/api"
import { amountExceedsLimit } from "@/lib/money"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { currencySymbol, useBalancePrivacy } from "@/lib/wealth"
import { useModalDraft } from "@/hooks/use-modal-draft"
import type { Card, CardKind, WealthAccount } from "@/lib/types"
import { cardDisplayName, maskedTail, resolveCardPalette } from "@/lib/cards"
import {
  CARD_WIZARD_FIELD_SELECTOR,
  cardCreatePayload,
  cardEditPayload,
  cardPreviewProps,
  cardWizardDirty,
  cardWizardFieldForServerError,
  cardWizardFormFromCard,
  cardWizardStepForField,
  cardWizardSteps,
  defaultHolderName,
  duplicateLast4,
  emptyCardWizardForm,
  parseCardApiError,
  validateCardWizard,
  validateCardWizardStep,
  type CardWizardField,
  type CardWizardForm,
  type CardWizardStep,
} from "@/lib/card-wizard"
import { cn } from "@/lib/utils"
import { CardVisual } from "@/components/cards/CardVisual"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollHint } from "./wizard/ScrollHint"
import { StepCredit } from "./wizard/StepCredit"
import { StepDetails } from "./wizard/StepDetails"
import { StepLook } from "./wizard/StepLook"
import { StepType } from "./wizard/StepType"

export type AddCardWizardProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode?: "create" | "edit"
  /** Edit mode: the card being edited. */
  card?: Card | null
  /** Preselect the linked bank (debit) / paying bank (credit) — e.g. from a bank page. */
  presetBankId?: string | null
  presetKind?: CardKind
  onSaved?: (card: Card) => void
}

type Quota = {
  plan_key: string
  bank_accounts: { current: number; limit: number }
  credit_cards: { current: number; limit: number }
}

const todayIso = () => new Date().toISOString().slice(0, 10)
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * Add / edit a card, one question per step, inside one responsive dialog — a
 * bottom sheet on phones, centred on larger screens — with a live CardVisual
 * that repaints as the user types.
 *
 * Steps: "Type & bank" → "Card details" → "Look" (+ "Credit details" for a
 * credit card). Editing drops the first step: the kind and the linked bank are
 * fixed once the card exists. Every rule (steps, validation, payloads, which
 * field a server error belongs to) lives in src/lib/card-wizard.ts.
 *
 * Dismissing (Esc, outside click, the X) keeps the draft for the next open;
 * a successful save clears it. Switching workspace while open starts over.
 */
export function AddCardWizard({ open, onOpenChange, mode = "create", card = null, presetBankId = null, presetKind, onSaved }: AddCardWizardProps) {
  const { t } = useTranslation("wealth")
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { user } = useUser()
  const { activeOrg, profile } = useOrg()
  const { currency } = useCurrency()
  const symbol = currencySymbol(currency)
  const { balancesVisible } = useBalancePrivacy()

  const editing = mode === "edit" && !!card
  const [form, setForm] = useState<CardWizardForm>(() => emptyCardWizardForm())
  const initialRef = useRef<CardWizardForm>(form)
  const [stepIndex, setStepIndex] = useState(0)
  const [errors, setErrors] = useState<Partial<Record<CardWizardField, string>>>({})
  const [saving, setSaving] = useState(false)
  const [banks, setBanks] = useState<WealthAccount[]>([])
  const [cards, setCards] = useState<Card[]>([])
  const [quota, setQuota] = useState<Quota | null>(null)
  const [upgrade, setUpgrade] = useState<null | "bank" | "credit_card">(null)
  // Banks + allowance + cards have arrived (pickers hold off auto-expanding until then).
  const [loaded, setLoaded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const steps = useMemo(() => cardWizardSteps(form.kind, mode), [form.kind, mode])
  const safeIndex = Math.min(stepIndex, steps.length - 1)
  const step: CardWizardStep = steps[safeIndex]
  const isLast = safeIndex === steps.length - 1

  const contextKey = `${mode}:${card?.id ?? "new"}:${presetBankId ?? ""}:${presetKind ?? ""}`
  const draft = useModalDraft({ open, dirty: cardWizardDirty(form, initialRef.current), contextKey })

  const seed = useCallback(() => {
    const next = editing
      ? cardWizardFormFromCard(card)
      : emptyCardWizardForm({
          kind: presetKind,
          account_id: presetBankId,
          funding_account_id: presetBankId,
          holder_name: defaultHolderName(user?.fullName, profile?.full_name),
        })
    initialRef.current = next
    setForm(next)
    setStepIndex(0)
    setErrors({})
  }, [editing, card, presetKind, presetBankId, user?.fullName, profile?.full_name])

  const loadData = useCallback(async () => {
    const token = await getToken()
    if (!token) return
    const [accts, q, rows] = await Promise.all([
      apiGet<WealthAccount[]>("/api/wealth/accounts", token).catch(() => [] as WealthAccount[]),
      apiGet<Quota>("/api/wealth/quota", token).catch(() => null),
      apiGet<Card[]>("/api/cards", token).catch(() => [] as Card[]),
    ])
    const active = accts.filter((a) => a.type === "bank" && !a.archived_at)
    setBanks(active)
    // One bank in the workspace = no choice to make: answer it for them (the
    // free plan allows exactly one, so this is the common case). It counts as
    // part of the seed, not as something the user typed — otherwise dismissing
    // an untouched wizard would leave a "draft" behind.
    if (mode === "create" && active.length === 1) {
      const fill = (f: CardWizardForm): CardWizardForm =>
        f.kind !== "debit" || f.account_id ? f : { ...f, account_id: active[0].id, funding_account_id: f.funding_account_id || active[0].id }
      initialRef.current = fill(initialRef.current)
      setForm(fill)
    }
    setQuota(q)
    setCards(rows)
    setLoaded(true)
  }, [getToken, mode])

  // Open: re-arm transient state, seed unless a dismissed draft is waiting, load data.
  useEffect(() => {
    if (!open) return
    setSaving(false)
    setUpgrade(null)
    setLoaded(false)
    if (draft.shouldSeed()) seed()
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // A workspace switch while the wizard is open: its banks/quota/cards are a
  // different set — start over rather than save a card into the wrong workspace.
  const orgRef = useRef(activeOrg?.id)
  useEffect(() => {
    if (orgRef.current === activeOrg?.id) return
    orgRef.current = activeOrg?.id
    if (!open) return
    draft.clearDraft()
    seed()
    setLoaded(false)
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id])

  // Each step starts at the top: a step swap keeps the scroll offset otherwise,
  // which lands the user mid-form on a question they haven't read.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" })
  }, [step])

  // Plan allowances (gate up front instead of ending in a 402).
  const isFreePlan = (quota?.plan_key ?? "free") === "free"
  const canAddBank = !quota || quota.bank_accounts.current < quota.bank_accounts.limit
  const creditLocked = !editing && !!quota && quota.credit_cards.current >= quota.credit_cards.limit
  // Opened preselected on Credit while the allowance is used up: say so at once.
  useEffect(() => {
    if (open && creditLocked && form.kind === "credit") {
      setForm((f) => ({ ...f, kind: "debit" }))
      setUpgrade("credit_card")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditLocked])

  const patch = (p: Partial<CardWizardForm>) => {
    setForm((f) => ({ ...f, ...p }))
    // A field the user just touched is no longer in error.
    if (Object.keys(errors).length) setErrors({})
  }

  const onBankCreated = (bank: WealthAccount) => {
    setBanks((prev) => (prev.some((b) => b.id === bank.id) ? prev : [...prev, bank]))
    setQuota((q) => (q ? { ...q, bank_accounts: { ...q.bank_accounts, current: q.bank_accounts.current + 1 } } : q))
  }

  const selectedBank = useMemo(() => {
    const id = form.kind === "credit" ? form.funding_account_id : form.account_id
    return banks.find((b) => b.id === id) ?? null
  }, [banks, form.kind, form.account_id, form.funding_account_id])
  // The preview's bank: a debit card's bank; a credit card is painted from its issuer.
  const previewBank = form.kind === "debit" ? selectedBank : null
  const preview = useMemo(() => cardPreviewProps(form, previewBank, editing ? card : null), [form, previewBank, editing, card])
  const duplicate = useMemo(() => duplicateLast4(cards, form, card?.id), [cards, form, card?.id])

  /**
   * Put the caret on the field that blocked the step (and scroll it into view):
   * on a phone the offending field is usually above the fold by the time the
   * user reaches Next.
   */
  const focusField = (field: CardWizardField) => {
    requestAnimationFrame(() => {
      const root = document.querySelector<HTMLElement>("[data-card-wizard]")
      const el = root?.querySelector<HTMLElement>(CARD_WIZARD_FIELD_SELECTOR[field])
      if (!el) return
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" })
    })
  }

  function goToField(field: CardWizardField, message: string) {
    setErrors({ [field]: message })
    const idx = steps.indexOf(cardWizardStepForField(field))
    if (idx >= 0 && idx !== safeIndex) {
      setStepIndex(idx)
      toast.error(message)
    }
    focusField(field)
  }

  function next() {
    const problem = validateCardWizardStep(form, step, mode, todayIso(), initialRef.current)
    if (problem) {
      setErrors({ [problem.field]: t(`cardWizard.errors.${problem.code}`) })
      focusField(problem.field)
      return
    }
    setErrors({})
    if (!isLast) setStepIndex(safeIndex + 1)
    else void save()
  }

  function back() {
    setErrors({})
    setStepIndex(Math.max(0, safeIndex - 1))
  }

  async function save() {
    const problem = validateCardWizard(form, mode, todayIso(), initialRef.current)
    if (problem) {
      goToField(problem.field, t(`cardWizard.errors.${problem.code}`))
      return
    }
    if (form.kind === "credit") {
      const c = form.credit
      if ([c.credit_limit, c.current_debt, c.statement_balance].some((v) => v.trim() !== "" && amountExceedsLimit(v))) {
        goToField("credit_limit", t("cardWizard.errors.amountTooLarge"))
        return
      }
    }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const saved = editing
        ? await apiPatch<Card>(`/api/cards/${card.id}`, token, cardEditPayload(form))
        : await apiPost<Card>("/api/cards", token, cardCreatePayload(form))
      draft.clearDraft()
      toast.success(editing ? t("cardWizard.updated") : t("cardWizard.created"))
      onOpenChange(false)
      onSaved?.(saved)
    } catch (err) {
      const body = parseCardApiError(err)
      if (body?.upgradeHint) {
        setUpgrade(body.step === "bank" ? "bank" : "credit_card")
        return
      }
      const message = apiErrorMessage(err, t("cardWizard.saveFailed"))
      const field = cardWizardFieldForServerError(body)
      if (field) {
        goToField(field, message)
        if (steps.indexOf(cardWizardStepForField(field)) === safeIndex) toast.error(message)
      } else {
        toast.error(message)
      }
    } finally {
      setSaving(false)
    }
  }

  const stepLabel = t(`cardWizard.steps.${step}`)
  const stepOf = t("cardWizard.stepOf", { current: safeIndex + 1, total: steps.length })
  const strip = resolveCardPalette({ tier: preview.tier, design: preview.design, brand_colors: preview.brand_colors, brand_domain: preview.brand_domain })
  const stripName = cardDisplayName({ name: form.name, network: form.network, kind: form.kind, account_bank_name: preview.bank_name })

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (saving) return
          if (!o) setUpgrade(null)
          onOpenChange(o)
        }}
      >
        <DialogContent
          data-card-wizard
          className="inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl"
        >
          <DialogHeader className="shrink-0 gap-1 border-b px-6 pe-10 pb-3 pt-5 text-start sm:text-start">
            <DialogTitle className="text-base">{editing ? t("cardWizard.titleEdit") : t("cardWizard.titleCreate")}</DialogTitle>
            <DialogDescription className="text-xs">
              {stepOf} · {stepLabel}
            </DialogDescription>
            {/* One segment per step: how far in, and how much is left, at a glance. */}
            <div
              className="mt-1.5 flex gap-1"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={steps.length}
              aria-valuenow={safeIndex + 1}
              aria-valuetext={`${stepOf} · ${stepLabel}`}
            >
              {steps.map((s, i) => (
                <span
                  key={s}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors duration-300 motion-reduce:transition-none",
                    i <= safeIndex ? "bg-primary" : "bg-muted",
                  )}
                />
              ))}
            </div>
          </DialogHeader>

          {/* A nested flex column, not a `h-full` child: the scroll area must be
              flex-sized (a percentage height can't resolve against a flex item
              whose own height is indefinite — it would spill over the footer). */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
              <div ref={contentRef}>
                {/* The live preview: scrolls with the form on phones, stays put on larger screens. */}
                <div className="px-6 pb-4 pt-4 sm:sticky sm:top-0 sm:z-10 sm:border-b sm:bg-background">
                  {step === "credit" ? (
                    <div className="flex h-12 items-center gap-3 rounded-xl border bg-card px-3 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
                      <span aria-hidden className="h-7 w-11 shrink-0 rounded-md ring-1 ring-black/10 dark:ring-white/10" style={{ background: `linear-gradient(135deg, ${strip.from} 0%, ${strip.to} 100%)` }} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{stripName}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground" dir="ltr">{maskedTail(form.last4)}</span>
                    </div>
                  ) : (
                    <div className="mx-auto w-full max-w-[224px] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 sm:max-w-[288px]">
                      <CardVisual {...preview} size="md" still />
                    </div>
                  )}
                </div>

                <div key={step} className="px-6 pb-8 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200">
                  {step === "type" && (
                    <StepType
                      form={form}
                      onChange={patch}
                      mode={mode}
                      banks={banks}
                      currency={currency}
                      balancesVisible={balancesVisible}
                      errors={errors}
                      creditLocked={creditLocked}
                      canAddBank={canAddBank}
                      onQuotaHit={setUpgrade}
                      onBankCreated={onBankCreated}
                      ready={loaded}
                    />
                  )}
                  {step === "details" && (
                    <StepDetails
                      form={form}
                      onChange={patch}
                      mode={mode}
                      initial={initialRef.current}
                      selectedBank={form.kind === "debit" ? selectedBank : null}
                      errors={errors}
                      duplicate={duplicate}
                      today={todayIso()}
                      savedCard={editing ? card : null}
                    />
                  )}
                  {step === "look" && (
                    <StepLook form={form} onChange={patch} mode={mode} selectedBank={previewBank} savedCard={editing ? card : null} errors={errors} />
                  )}
                  {step === "credit" && (
                    <StepCredit
                      form={form}
                      onChange={patch}
                      mode={mode}
                      symbol={symbol}
                      banks={banks}
                      currency={currency}
                      balancesVisible={balancesVisible}
                      errors={errors}
                      canAddBank={canAddBank}
                      onBankCreated={onBankCreated}
                      onQuotaHit={() => setUpgrade("bank")}
                      ready={loaded}
                    />
                  )}
                </div>
              </div>
            </div>
            <ScrollHint scrollRef={scrollRef} contentRef={contentRef} />
          </div>

          <DialogFooter className="shrink-0 flex-row items-center justify-between gap-2 border-t px-6 pb-6 pt-3 sm:justify-between">
            {safeIndex > 0 ? (
              <Button type="button" variant="outline" className="min-h-11" onClick={back} disabled={saving}>
                <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
                {t("cardWizard.back")}
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" className={cn("min-h-11 min-w-28", isLast && "min-w-32")} onClick={next} disabled={saving} data-wizard-next>
              {saving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : isLast ? (
                <>
                  <Check className="size-4" aria-hidden />
                  {editing ? t("cardWizard.saveChanges") : t("cardWizard.save")}
                </>
              ) : (
                <>
                  {t("cardWizard.next")}
                  <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* At the plan's allowance: free → upgrade prompt; paid → the hard cap explanation.
          Stacked over the wizard, so it must NOT push its own Back entry: the
          Dialog wrapper's useBackClose pops history when a dialog closes, and that
          popstate would slam the wizard shut too (src/hooks/use-back-close.ts). */}
      <Dialog open={!!upgrade} onOpenChange={(o) => { if (!o) setUpgrade(null) }} disableBackClose>
        <DialogContent className="w-[92vw] max-w-sm">
          <DialogHeader className="text-start sm:text-start">
            <DialogTitle className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-full bg-amber-500/15">
                <Crown className="size-4 text-amber-500 dark:text-amber-400" aria-hidden />
              </span>
              {upgrade === "credit_card"
                ? isFreePlan ? t("upgradeCardsTitle") : t("cardLimitTitle")
                : isFreePlan ? t("upgradeBanksTitle") : t("bankLimitTitle")}
            </DialogTitle>
            <DialogDescription className="text-start">
              {upgrade === "credit_card"
                ? isFreePlan
                  ? t("upgradeCardsBody", { limit: quota?.credit_cards.limit ?? 1 })
                  : t("cardLimitBody", { limit: quota?.credit_cards.limit ?? 20 })
                : isFreePlan
                  ? t("upgradeBanksBody", { limit: quota?.bank_accounts.limit ?? 1 })
                  : t("bankLimitBody", { limit: quota?.bank_accounts.limit ?? 20 })}
            </DialogDescription>
          </DialogHeader>
          {quota && (
            <p className="text-xs font-medium tabular-nums text-muted-foreground">
              {upgrade === "credit_card"
                ? t("cardUsage", { current: quota.credit_cards.current, limit: quota.credit_cards.limit })
                : t("bankUsage", { current: quota.bank_accounts.current, limit: quota.bank_accounts.limit })}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="min-h-11" onClick={() => setUpgrade(null)}>{t("cancel")}</Button>
            {isFreePlan && (
              <Button
                className="min-h-11 bg-amber-500 text-white hover:bg-amber-600 dark:bg-amber-500 dark:hover:bg-amber-400"
                onClick={() => { setUpgrade(null); onOpenChange(false); navigate("/subscription") }}
              >
                <Sparkles className="size-4" aria-hidden /> {t("upgradeBanksCta")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
