// The add/edit-card wizard's form model, kept as a plain module (no React, no
// I/O) so every rule the dialog applies — which steps exist, what blocks Next,
// which field a server error points at, what the API bodies look like — is
// unit-tested in card-wizard.test.ts and never disagrees with the server.
//
// The credit block reuses CardFormState (src/lib/card-form.ts) so the wizard
// can embed the existing CreditCardFormFields unchanged.

import type { Card, CardDesign, CardKind, CardNetwork, CardTier, WealthAccount } from "@/lib/types"
import { type CardFormState, cardFormFromAccount, emptyCardForm } from "@/lib/card-form"
import { validateCardOnboarding, type CardOnboardingError } from "@/lib/credit-card"
import {
  CARD_TAIL_MAX,
  cardDisplayName,
  cardTail,
  darken,
  expiryLabel,
  isCardExpired,
  isCardNetwork,
  isHexColor,
  isValidLast4,
  normalizeHex,
  parseExpiry,
  readableTextOn,
  resolveCardPalette,
} from "@/lib/cards"
import type { CardVisualProps } from "@/components/cards/types"

// ── Shape ────────────────────────────────────────────────────────────────────

export type CardWizardMode = "create" | "edit"
/**
 * One question per step: what it is and where it lives → what is printed on it
 * → how it looks → (credit) how it works. Editing skips "type" because nothing
 * on it can change after creation.
 */
export type CardWizardStep = "type" | "details" | "look" | "credit"

export type CardWizardForm = {
  kind: CardKind
  /**
   * The BANK this card belongs to, for both kinds: a debit card spends from it,
   * a credit card was issued by it. Always a real, active wealth account — the
   * picker creates one inline when the user has no account with that bank yet,
   * which is what makes an issuer countable against the plan's bank limit.
   */
  account_id: string
  /**
   * The issuer's branding, mirrored from the picked bank so the live preview
   * and the nickname placeholder have something to draw before the card is
   * saved. Not typed by the user any more; still sent so the server can brand a
   * card whose issuer is not one of the user's accounts.
   */
  issuer_name: string
  issuer_domain: string
  issuer_logo_url: string
  /** "" until the user picks one — the network is a required detail. */
  network: CardNetwork | ""
  /** 4 to 6 digits (CARD_TAIL_MIN..CARD_TAIL_MAX). */
  last4: string
  /** "MM/YY" as typed; parsed on validation (parseExpiry). */
  expiry: string
  holder_name: string
  /** Nickname — empty means "<Bank> <Network>" (cardDisplayName). */
  name: string
  tier: CardTier
  /** Only sent when tier === "custom". */
  design: CardDesign
  /** The text colour follows the colours until the user forces light/dark. */
  design_text_auto: boolean
  /** Credit only: limit / owed today / cycle days / known statement. */
  credit: CardFormState
  /** Credit only: the ACCOUNT the statement is paid from ("" = pay it manually). */
  funding_account_id: string
  /**
   * Credit only: the CARD used to pay it, when the answer is a card rather than
   * a bare account. Always resolves to funding_account_id — a debit card means
   * the money leaves its bank, a credit card means a balance transfer.
   */
  funding_card_id: string
  /** Credit only; opt-in, needs a funding bank. */
  autopay: boolean
}

export const DEFAULT_CUSTOM_DESIGN: CardDesign = { from: "#2F3A56", to: "#151B2E", text: "light", pattern: "none" }

export function emptyCardWizardForm(init: {
  kind?: CardKind | null
  account_id?: string | null
  funding_account_id?: string | null
  holder_name?: string | null
} = {}): CardWizardForm {
  return {
    kind: init.kind ?? "debit",
    account_id: init.account_id ?? "",
    issuer_name: "",
    issuer_domain: "",
    issuer_logo_url: "",
    network: "",
    last4: "",
    expiry: "",
    holder_name: init.holder_name ?? "",
    name: "",
    tier: "standard",
    design: { ...DEFAULT_CUSTOM_DESIGN },
    design_text_auto: true,
    credit: { ...emptyCardForm },
    funding_account_id: init.funding_account_id ?? "",
    funding_card_id: "",
    autopay: false,
  }
}

/** Seed the edit form from a saved card (identity + credit configuration). */
export function cardWizardFormFromCard(card: Card): CardWizardForm {
  const design = card.design ?? { ...DEFAULT_CUSTOM_DESIGN }
  return {
    kind: card.kind,
    account_id: card.kind === "debit" ? card.account_id : (card.issuer_account_id ?? ""),
    issuer_name: card.account_bank_name ?? "",
    issuer_domain: card.account_brand_domain ?? "",
    issuer_logo_url: card.account_logo_url ?? "",
    network: card.network,
    last4: card.last4 ?? "",
    expiry: expiryLabel(card.expiry_month, card.expiry_year),
    holder_name: card.holder_name ?? "",
    name: card.name ?? "",
    tier: card.tier,
    design: { ...design },
    // A saved custom design already carries an explicit text choice; keep it.
    design_text_auto: card.tier !== "custom",
    credit:
      card.kind === "credit"
        ? cardFormFromAccount({
            bank_name: card.account_bank_name ?? "",
            nickname: card.account_nickname ?? card.name,
            icon: "card",
            brand_domain: card.account_brand_domain,
            logo_url: card.account_logo_url,
            credit_limit: card.account_credit_limit,
            statement_closing_day: card.account_statement_closing_day,
            payment_due_day: card.account_payment_due_day,
          })
        : { ...emptyCardForm },
    funding_account_id: card.funding_account_id ?? "",
    funding_card_id: card.funding_card_id ?? "",
    autopay: card.autopay,
  }
}

/** The holder-name default: the signed-in user's name, else the profile's, else blank. */
export function defaultHolderName(clerkFullName: string | null | undefined, profileFullName: string | null | undefined): string {
  return (clerkFullName ?? "").trim() || (profileFullName ?? "").trim() || ""
}

// ── Steps ────────────────────────────────────────────────────────────────────

/**
 * Creating: "Type & bank" → "Card details" → "Look" (3), plus "Credit details"
 * for a credit card (4). Editing drops the first step — the kind and the linked
 * bank are fixed once the card exists, so a step of read-only rows would just
 * be one more Next to press.
 */
export function cardWizardSteps(kind: CardKind, mode: CardWizardMode = "create"): CardWizardStep[] {
  const steps: CardWizardStep[] = mode === "edit" ? ["details", "look"] : ["type", "details", "look"]
  if (kind === "credit") steps.push("credit")
  return steps
}

// ── Validation ───────────────────────────────────────────────────────────────

export type CardWizardCode =
  | CardOnboardingError
  | "bank_required"
  | "issuer_required"
  | "network_required"
  | "last4_required"
  | "last4_range"
  | "expiry_required"
  | "expiry_invalid"
  | "holder_required"
  | "design_invalid"
  | "funding_required"

export type CardWizardField =
  | "account_id"
  | "issuer_name"
  | "network"
  | "last4"
  | "expiry"
  | "holder_name"
  | "design"
  | "credit_limit"
  | "current_debt"
  | "statement_closing_day"
  | "payment_due_day"
  | "statement_balance"
  | "statement_closing_date"
  | "funding_account_id"

export type CardWizardIssue = { code: CardWizardCode; field: CardWizardField }

export const CARD_WIZARD_FIELD_FOR_CODE: Record<CardWizardCode, CardWizardField> = {
  bank_required: "account_id",
  issuer_required: "account_id",
  network_required: "network",
  last4_required: "last4",
  last4_range: "last4",
  expiry_required: "expiry",
  expiry_invalid: "expiry",
  holder_required: "holder_name",
  design_invalid: "design",
  funding_required: "funding_account_id",
  limit_invalid: "credit_limit",
  debt_invalid: "current_debt",
  closing_day_invalid: "statement_closing_day",
  due_day_invalid: "payment_due_day",
  same_day: "payment_due_day",
  statement_balance_invalid: "statement_balance",
  statement_date_invalid: "statement_closing_date",
  statement_in_future: "statement_closing_date",
}

/** Which step a field lives on (where to send the user when the server complains). */
export function cardWizardStepForField(field: CardWizardField): CardWizardStep {
  switch (field) {
    case "account_id":
    case "issuer_name":
      return "type"
    case "network":
    case "last4":
    case "expiry":
    case "holder_name":
      return "details"
    case "design":
      return "look"
    default:
      return "credit"
  }
}

/**
 * Where to put the caret when a step is blocked. Selectors are scoped to the
 * wizard dialog ([data-card-wizard]); the credit ids come from
 * CreditCardFormFields, which the credit step embeds unchanged.
 */
export const CARD_WIZARD_FIELD_SELECTOR: Record<CardWizardField, string> = {
  // One rule, two pickers: step 1 is `bank` for a debit card and `issuer` for
  // a credit one, and both write to account_id.
  account_id: '[data-bank-picker="bank"] [data-bank-option], [data-bank-picker="issuer"] [data-bank-option]',
  issuer_name: '[data-bank-picker="issuer"] [data-bank-option]',
  network: "[data-network-rail] [data-network]",
  last4: "#card-last4",
  expiry: "#card-expiry",
  holder_name: "#card-holder",
  design: '[data-tier="custom"]',
  credit_limit: "#cc-limit",
  current_debt: "#cc-debt",
  statement_closing_day: "#cc-closing",
  payment_due_day: "#cc-due",
  statement_balance: "#cc-st-balance",
  statement_closing_date: "#cc-st-close",
  funding_account_id: '[data-bank-picker="funding"] [data-bank-option]',
}

/**
 * Which printed details this run must have. Creating a card requires all of
 * them — a card with no number and no name renders as a blank rectangle, which
 * is exactly the bug this rule closes. Editing only requires what the saved
 * card already had, so a card added before the rule stays editable (and its
 * blank tail can be filled in) instead of becoming unsavable.
 */
export function requiredCardDetails(mode: CardWizardMode, initial?: CardWizardForm | null): { network: boolean; last4: boolean; expiry: boolean; holder: boolean } {
  if (mode === "create") return { network: true, last4: true, expiry: true, holder: true }
  // No seed to compare against → assume the card predates the rule and only
  // check what the user actually typed (never block an existing card's save).
  return {
    network: true,
    last4: !!initial && initial.last4.trim() !== "",
    expiry: !!initial && initial.expiry.trim() !== "",
    holder: !!initial && initial.holder_name.trim() !== "",
  }
}

const issue = (code: CardWizardCode): CardWizardIssue => ({ code, field: CARD_WIZARD_FIELD_FOR_CODE[code] })
const int = (v: string): number => (v.trim() === "" ? NaN : Number(v))

/**
 * The first problem on one step, or null. Blocking rules only — a duplicate
 * tail or a past expiry are warnings (see duplicateLast4 / isExpiryPast).
 * `initial` is the form as it was seeded; it only relaxes the mandatory printed
 * details when editing a card that never had them (requiredCardDetails).
 */
export function validateCardWizardStep(
  form: CardWizardForm,
  step: CardWizardStep,
  mode: CardWizardMode,
  today: string,
  initial?: CardWizardForm | null,
): CardWizardIssue | null {
  if (step === "type") {
    if (mode !== "create") return null
    // Both kinds now name a real bank: the one a debit card spends from, or
    // the one that issued a credit card.
    if (!form.account_id) return issue(form.kind === "credit" ? "issuer_required" : "bank_required")
    return null
  }
  if (step === "details") {
    const need = requiredCardDetails(mode, initial)
    if (need.network && !isCardNetwork(form.network)) return issue("network_required")
    const tail = form.last4.trim()
    if (tail === "") {
      if (need.last4) return issue("last4_required")
    } else if (!isValidLast4(tail)) {
      return issue("last4_range")
    }
    const expiry = form.expiry.trim()
    if (expiry === "") {
      if (need.expiry) return issue("expiry_required")
    } else if (!parseExpiry(expiry)) {
      return issue("expiry_invalid")
    }
    if (need.holder && !form.holder_name.trim()) return issue("holder_required")
    return null
  }
  if (step === "look") {
    if (form.tier === "custom" && (!isHexColor(form.design.from) || !isHexColor(form.design.to))) return issue("design_invalid")
    return null
  }
  // credit
  if (form.kind !== "credit") return null
  const c = form.credit
  const code = validateCardOnboarding(
    {
      creditLimit: Number(c.credit_limit),
      // After creation the debt lives in the ledger — only the limit + cycle days are editable.
      currentDebt: mode === "edit" ? 0 : c.current_debt.trim() === "" ? 0 : Number(c.current_debt),
      statementClosingDay: int(c.statement_closing_day),
      paymentDueDay: int(c.payment_due_day),
      statement:
        mode === "create" && c.know_statement
          ? { balance: c.statement_balance.trim() === "" ? 0 : Number(c.statement_balance), closingDate: c.statement_closing_date }
          : null,
    },
    today,
  )
  if (code) return issue(code)
  if (form.autopay && !form.funding_account_id) return issue("funding_required")
  return null
}

/** The first problem across every step of the form (run before saving). */
export function validateCardWizard(form: CardWizardForm, mode: CardWizardMode, today: string, initial?: CardWizardForm | null): CardWizardIssue | null {
  for (const step of cardWizardSteps(form.kind, mode)) {
    const found = validateCardWizardStep(form, step, mode, today, initial)
    if (found) return found
  }
  return null
}

/** True when the typed expiry parses and is already in the past (a warning, not a block). */
export function isExpiryPast(expiry: string, today: string): boolean {
  const parsed = parseExpiry(expiry)
  return !!parsed && isCardExpired(parsed.month, parsed.year, today)
}

// ── Server errors ────────────────────────────────────────────────────────────

export type CardApiErrorBody = { error?: string; reason?: string; code?: string; step?: string; upgradeHint?: boolean }

/** Parse the JSON body an apiPost/apiPatch rejection carries (null when it isn't ours). */
export function parseCardApiError(err: unknown): CardApiErrorBody | null {
  if (!(err instanceof Error)) return null
  const m = err.message.trim()
  if (!m.startsWith("{")) return null
  try {
    return JSON.parse(m) as CardApiErrorBody
  } catch {
    return null
  }
}

/**
 * Which field a POST/PATCH /api/cards 400 points at: the credit block's
 * validateCardOnboarding `code` first, else the identity messages the route
 * writes in plain English. Null = show the message as a toast only.
 */
export function cardWizardFieldForServerError(body: CardApiErrorBody | null): CardWizardField | null {
  if (!body) return null
  if (body.code && body.code in CARD_WIZARD_FIELD_FOR_CODE) return CARD_WIZARD_FIELD_FOR_CODE[body.code as CardWizardCode]
  const msg = (body.error ?? "").toLowerCase()
  if (!msg) return null
  if (/last4|four digits|\d\s*to\s*\d\s*digits/.test(msg)) return "last4"
  if (/expiry/.test(msg)) return "expiry"
  if (/design|colour|color/.test(msg)) return "design"
  if (/credit_limit|credit limit/.test(msg)) return "credit_limit"
  if (/closing day and due day|payment_due_day|due day/.test(msg)) return "payment_due_day"
  if (/statement_closing_day|closing day/.test(msg)) return "statement_closing_day"
  if (/paying account|pays this card|funding/.test(msg)) return "funding_account_id"
  if (/issued this card|issuer/.test(msg)) return "issuer_name"
  if (/bank account|bank/.test(msg)) return "account_id"
  return null
}

// ── Payloads ─────────────────────────────────────────────────────────────────

function expiryFields(expiry: string): { expiry_month: number | null; expiry_year: number | null } {
  const parsed = parseExpiry(expiry)
  return { expiry_month: parsed?.month ?? null, expiry_year: parsed?.year ?? null }
}

/** The custom design as the server expects it (text resolved when it was "auto"). */
export function effectiveDesign(form: CardWizardForm): CardDesign {
  const from = isHexColor(form.design.from) ? normalizeHex(form.design.from) : DEFAULT_CUSTOM_DESIGN.from
  const to = isHexColor(form.design.to) ? normalizeHex(form.design.to) : darken(from, 0.45)
  return {
    from,
    to,
    text: form.design_text_auto ? readableTextOn(from) : form.design.text,
    pattern: form.design.pattern,
  }
}

function identityPayload(form: CardWizardForm) {
  return {
    name: form.name.trim(),
    holder_name: form.holder_name.trim(),
    network: form.network,
    last4: form.last4.trim(),
    ...expiryFields(form.expiry),
    tier: form.tier,
    design: form.tier === "custom" ? effectiveDesign(form) : null,
  }
}

function creditBlock(c: CardFormState, mode: CardWizardMode) {
  const base = {
    credit_limit: Number(c.credit_limit),
    statement_closing_day: int(c.statement_closing_day),
    payment_due_day: int(c.payment_due_day),
  }
  if (mode === "edit") return base
  return {
    ...base,
    current_debt: c.current_debt.trim() === "" ? 0 : Number(c.current_debt),
    statement: c.know_statement
      ? {
          balance: c.statement_balance.trim() === "" ? 0 : Number(c.statement_balance),
          closing_date: c.statement_closing_date,
          ...(c.statement_due_date ? { due_date: c.statement_due_date } : {}),
        }
      : null,
  }
}

/** POST /api/cards body. */
export function cardCreatePayload(form: CardWizardForm) {
  const identity = identityPayload(form)
  if (form.kind === "debit") {
    return { kind: "debit" as const, account_id: form.account_id, ...identity }
  }
  return {
    kind: "credit" as const,
    // The issuer as an ACCOUNT. With a real account the SERVER derives the
    // branding from that bank row, so the form's mirrored copy is deliberately
    // not sent: two sources for one fact is how they drift apart. The mirror is
    // only sent when there is no account to derive from.
    account_id: form.account_id,
    ...(form.account_id
      ? {}
      : {
          issuer: {
            bank_name: form.issuer_name.trim(),
            brand_domain: form.issuer_domain,
            logo_url: form.issuer_logo_url,
          },
        }),
    ...(form.funding_account_id ? { funding_account_id: form.funding_account_id } : {}),
    ...(form.funding_card_id ? { funding_card_id: form.funding_card_id } : {}),
    autopay: !!form.funding_account_id && form.autopay,
    ...identity,
    credit: creditBlock(form.credit, "create"),
  }
}

/** PATCH /api/cards/:id body — identity always; credit configuration + funding + autopay for credit cards. */
export function cardEditPayload(form: CardWizardForm) {
  const identity = identityPayload(form)
  if (form.kind === "debit") return identity
  return {
    ...identity,
    credit: creditBlock(form.credit, "edit"),
    funding_account_id: form.funding_account_id || null,
    funding_card_id: form.funding_card_id || null,
    autopay: !!form.funding_account_id && form.autopay,
  }
}

// ── Preview ──────────────────────────────────────────────────────────────────

/** The bank name the preview and the nickname placeholder use. */
export function wizardBankName(form: CardWizardForm, bank: Pick<WealthAccount, "bank_name" | "nickname"> | null | undefined): string {
  // Both kinds name a real bank now, so one branch: the account picked in step
  // 1. `issuer_name` is only the fallback for a form seeded from a card whose
  // issuer account was never recorded (anything created before mig 0065).
  return (bank?.bank_name ?? "").trim() || (form.kind === "credit" ? form.issuer_name.trim() : "")
}

/** Placeholder for the nickname field: "<Bank> <Network>" (or "Visa card" without a bank). */
export function nicknamePlaceholder(form: CardWizardForm, bank: Pick<WealthAccount, "bank_name" | "nickname"> | null | undefined): string {
  return cardDisplayName({ name: "", network: form.network, kind: form.kind, account_bank_name: wizardBankName(form, bank) })
}

/**
 * What the live CardVisual shows for the current form. Brand colours are only
 * known once the server has fetched them (edit mode passes the saved card),
 * so a brand-new card previews with the curated colour for the bank's domain.
 */
export function cardPreviewProps(form: CardWizardForm, bank: WealthAccount | null | undefined, saved?: Card | null): CardVisualProps {
  const credit = form.kind === "credit"
  return {
    kind: form.kind,
    network: form.network,
    tier: form.tier,
    design: form.tier === "custom" ? effectiveDesign(form) : null,
    brand_colors: saved?.brand_colors ?? null,
    brand_domain: bank?.brand_domain || (credit ? form.issuer_domain : "") || null,
    brand_logo_url: saved?.brand_logo_url || null,
    bank_logo_src: bank?.logo_src || bank?.logo_url || (credit ? form.issuer_logo_url || saved?.account_logo_src : "") || null,
    bank_name: wizardBankName(form, bank) || null,
    name: form.name.trim() || null,
    holder_name: form.holder_name.trim() || null,
    last4: form.last4.trim() || null,
    ...expiryFields(form.expiry),
    status: saved?.status ?? "active",
  }
}

/** The swatch colours for a tier chip (Standard = the bank's colours). */
export function tierSwatch(tier: CardTier, form: CardWizardForm, bank: WealthAccount | null | undefined, saved?: Card | null): { from: string; to: string } {
  const p = resolveCardPalette({
    tier,
    design: tier === "custom" ? effectiveDesign(form) : null,
    brand_colors: saved?.brand_colors ?? null,
    brand_domain: bank?.brand_domain || (form.kind === "credit" ? form.issuer_domain : "") || null,
  })
  return { from: p.from, to: p.to }
}

/** True when the user forced a text colour the background can't carry. */
export function customTextUnreadable(form: CardWizardForm): boolean {
  if (form.tier !== "custom" || form.design_text_auto) return false
  return readableTextOn(effectiveDesign(form).from) !== form.design.text
}

// ── Small input helpers ──────────────────────────────────────────────────────

/**
 * Mask the expiry field as the user types: digits only, "MM/" inserted after
 * the month, a lone 2–9 becomes "0X/" (nobody means month 20), max "MM/YY".
 * Deleting past the slash removes the month's last digit too.
 */
export function formatExpiryInput(next: string, prev: string): string {
  const digits = next.replace(/\D/g, "").slice(0, 4)
  const deleting = next.length < prev.length
  if (digits.length === 0) return ""
  if (digits.length === 1) {
    if (!deleting && /[2-9]/.test(digits)) return `0${digits}/`
    return digits
  }
  if (digits.length === 2) return deleting ? digits : `${digits}/`
  return `${digits.slice(0, 2)}/${digits.slice(2)}`
}

/** Keep only digits, at most CARD_TAIL_MAX (6) of them. */
export function sanitizeLast4(v: string): string {
  return v.replace(/\D/g, "").slice(0, CARD_TAIL_MAX)
}

/**
 * Another open card on the same bank with the same tail — probably the same
 * card entered twice. A warning, never a block (two cards CAN share a tail).
 */
export function duplicateLast4(cards: Card[], form: CardWizardForm, excludeId?: string | null): Card | null {
  const tail = cardTail(form.last4)
  if (!tail) return null
  const issuer = form.issuer_name.trim().toLowerCase()
  return (
    cards.find((c) => {
      if (c.id === excludeId || c.status === "closed" || c.last4 !== tail) return false
      if (form.kind === "debit") return c.kind === "debit" && c.account_id === form.account_id
      // Same issuing bank: by account when both cards recorded one, else by the
      // branding name (cards created before the issuer became an account).
      if (c.kind !== "credit") return false
      if (form.account_id && c.issuer_account_id) return c.issuer_account_id === form.account_id
      return !!issuer && (c.account_bank_name ?? "").trim().toLowerCase() === issuer
    }) ?? null
  )
}

/** Has the user changed anything since the form was seeded? */
export function cardWizardDirty(form: CardWizardForm, initial: CardWizardForm): boolean {
  return JSON.stringify(form) !== JSON.stringify(initial)
}
