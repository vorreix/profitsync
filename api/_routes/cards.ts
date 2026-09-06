import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull, max } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { cards, wealthAccounts } from "../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../_lib/auth.js"
import { logAudit } from "../_lib/audit.js"
import { fetchBrandPalette } from "../_lib/bank-brand.js"
import { loadCard, loadCards, serializeCard } from "../_lib/cards.js"
import { syncCards } from "../_lib/card-autopay.js"
import { materializeDueRecurring } from "../_lib/recurring-materialize.js"
import { createWealthAccount, type CreateAccountInput } from "../_lib/wealth-accounts.js"
import { guessNetworkFromName, isCardKind, isCardNetwork, isCardTier, isValidLast4, sanitizeCardDesign } from "../../src/lib/cards.js"
import { todayIso } from "../../src/lib/recurring.js"

/**
 * Validate the identity fields shared by create + edit. Returns the columns to
 * write or an error message. Lenient where a user could plausibly be unsure
 * (no network → guessed from the name; no expiry → unknown), strict where a
 * bad value would corrupt the visual (last4, tier, design).
 */
export function pickCardIdentity(body: {
  name?: unknown
  holder_name?: unknown
  network?: unknown
  last4?: unknown
  expiry_month?: unknown
  expiry_year?: unknown
  tier?: unknown
  design?: unknown
}, fallbackName: string): { ok: true; value: { name: string; holderName: string; network: string; last4: string; expiryMonth: number | null; expiryYear: number | null; tier: string; design: ReturnType<typeof sanitizeCardDesign> } } | { ok: false; error: string } {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")
  const name = str(body.name, 60)
  const holderName = str(body.holder_name, 80)
  const network = isCardNetwork(body.network) ? body.network : guessNetworkFromName(`${name} ${fallbackName}`)
  const last4 = str(body.last4, 4)
  if (!isValidLast4(last4)) return { ok: false, error: "last4 must be exactly four digits" }
  const month = body.expiry_month == null || body.expiry_month === "" ? null : Number(body.expiry_month)
  const year = body.expiry_year == null || body.expiry_year === "" ? null : Number(body.expiry_year)
  if ((month === null) !== (year === null)) return { ok: false, error: "expiry needs both a month and a year" }
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) return { ok: false, error: "expiry_month must be 1..12" }
  if (year !== null && (!Number.isInteger(year) || year < 2000 || year > 2100)) return { ok: false, error: "expiry_year must be a four-digit year" }
  const tier = isCardTier(body.tier) ? body.tier : "standard"
  const design = tier === "custom" ? sanitizeCardDesign(body.design) : null
  if (tier === "custom" && !design) return { ok: false, error: "A custom design needs a valid colour" }
  return { ok: true, value: { name, holderName, network, last4, expiryMonth: month, expiryYear: year, tier, design } }
}

/**
 * GET  /api/cards           the org's cards (+ ?includeClosed=1), synced first
 * POST /api/cards           add a debit or credit card, creating its bank inline
 *                           (`new_bank`) and, for credit, its liability account.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method === "GET") {
    // Same discipline as the accounts list: recurring catch-up, statement
    // filing, autopay and alerts all happen before anything renders.
    await materializeDueRecurring(orgId)
    await syncCards(orgId).catch((err) => console.error("[cards] sync failed", err))
    const includeClosed = (req.query as { includeClosed?: string }).includeClosed === "1"
    const rows = await loadCards(orgId, { includeClosed })
    return res.json(rows.map(serializeCard))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const body = req.body as {
      kind?: unknown
      account_id?: string | null
      new_bank?: CreateAccountInput | null
      funding_account_id?: string | null
      issuer?: { bank_name?: string; brand_domain?: string; logo_url?: string } | null
      autopay?: unknown
      credit?: {
        credit_limit?: number | string
        current_debt?: number | string
        statement_closing_day?: number
        payment_due_day?: number
        statement?: { balance?: number | string; closing_date?: string; due_date?: string } | null
      } | null
    } & Parameters<typeof pickCardIdentity>[0]

    if (!isCardKind(body.kind)) return res.status(400).json({ error: "kind must be debit or credit" })
    const kind = body.kind

    // ── The linked bank: an existing active bank, or one created inline ──────
    let bank: typeof wealthAccounts.$inferSelect | null = null
    if (body.new_bank && typeof body.new_bank === "object") {
      const created = await createWealthAccount(orgId, userId, { ...body.new_bank, type: "bank" })
      if (!created.ok) return res.status(created.status).json({ ...created.body, step: "bank" })
      bank = created.row
    } else if (body.account_id) {
      const [row] = await db
        .select()
        .from(wealthAccounts)
        .where(and(eq(wealthAccounts.id, body.account_id), eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
      if (!row) return res.status(400).json({ error: "Select an active bank account" })
      if (row.type !== "bank") return res.status(400).json({ error: "A card links to a bank account" })
      bank = row
    }
    if (kind === "debit" && !bank) return res.status(400).json({ error: "A debit card needs a bank account" })

    // ── Identity ─────────────────────────────────────────────────────────────
    const issuerName = (body.issuer?.bank_name ?? "").trim() || bank?.bankName || ""
    if (kind === "credit" && !issuerName) return res.status(400).json({ error: "Choose the bank that issued this card" })
    const identity = pickCardIdentity(body, issuerName)
    if (!identity.ok) return res.status(400).json({ error: identity.error })
    const brandDomain = (body.issuer?.brand_domain ?? "").trim() || bank?.brandDomain || ""
    const logoUrl = (body.issuer?.logo_url ?? "").trim() || bank?.logoUrl || ""

    // ── The ledger account ───────────────────────────────────────────────────
    let ledgerAccountId: string
    let fundingAccountId: string | null = null
    if (kind === "credit") {
      const credit = body.credit ?? {}
      const created = await createWealthAccount(orgId, userId, {
        type: "credit_card",
        bank_name: issuerName,
        nickname: identity.value.name,
        icon: "card",
        brand_domain: brandDomain,
        logo_url: logoUrl,
        credit_limit: credit.credit_limit,
        current_debt: credit.current_debt,
        statement_closing_day: credit.statement_closing_day,
        payment_due_day: credit.payment_due_day,
        statement: credit.statement ?? null,
      })
      if (!created.ok) return res.status(created.status).json({ ...created.body, step: "credit" })
      ledgerAccountId = created.row.id
      // The funding bank: an explicit choice, else the bank picked in step 1.
      if (body.funding_account_id && body.funding_account_id !== bank?.id) {
        const [f] = await db
          .select({ id: wealthAccounts.id, type: wealthAccounts.type })
          .from(wealthAccounts)
          .where(and(eq(wealthAccounts.id, body.funding_account_id), eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
        if (!f || (f.type !== "bank" && f.type !== "cash")) return res.status(400).json({ error: "The paying account must be an active bank or cash account" })
        fundingAccountId = f.id
      } else {
        fundingAccountId = bank?.id ?? null
      }
    } else {
      ledgerAccountId = bank!.id
    }

    // ── Brand palette (fail-soft, cached) ────────────────────────────────────
    const palette = brandDomain ? await fetchBrandPalette(brandDomain).catch(() => null) : null

    // Autopay is OPT-IN: ProfitSync only mirrors money movement the user says
    // their bank actually makes ("Manual tracking only"). It needs a paying bank.
    const autopay = kind === "credit" && !!fundingAccountId && body.autopay === true
    const [{ maxPos }] = await db.select({ maxPos: max(cards.position) }).from(cards).where(eq(cards.organizationId, orgId))
    const [row] = await db
      .insert(cards)
      .values({
        organizationId: orgId,
        kind,
        accountId: ledgerAccountId,
        fundingAccountId,
        name: identity.value.name,
        holderName: identity.value.holderName,
        network: identity.value.network,
        last4: identity.value.last4,
        expiryMonth: identity.value.expiryMonth,
        expiryYear: identity.value.expiryYear,
        tier: identity.value.tier,
        design: identity.value.design,
        brandColors: palette?.colors.length ? palette.colors : null,
        brandLogoUrl: palette?.logo_dark_url ?? "",
        autopay,
        autopaySince: autopay ? todayIso() : null,
        status: "active",
        position: (maxPos ?? -1) + 1,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning()

    await logAudit({ orgId, entityType: "card", entityId: row.id, action: "create", actorId: userId })
    const full = await loadCard(orgId, row.id)
    return res.status(201).json(full ? serializeCard(full) : { id: row.id })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
