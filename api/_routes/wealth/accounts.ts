import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, count, eq, isNull, max, ne, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { creditCardStatements, transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canWrite, ensureDefaultClient, requireAuth } from "../../_lib/auth.js"
import { logAudit } from "../../_lib/audit.js"
import { type BankDetailInput, fetchLogoData, pickBankDetails, resolveLogoColumns } from "../../_lib/bank-brand.js"
import { amountExceedsLimit } from "../../../src/lib/money.js"
import { logoDataUrl } from "../../../src/lib/logo-data.js"
import { checkBankAccountQuota, checkCreditCardQuota } from "../../_lib/quota.js"
import { materializeDueRecurring } from "../../_lib/recurring-materialize.js"
import { dueDateFor, signedBalanceFromDebt, validateCardOnboarding } from "../../../src/lib/credit-card.js"
import { todayIso } from "../../../src/lib/recurring.js"

// "Cash in Hand" is the default account every workspace always has. We lazily
// provision it on first read so existing orgs (created before wealth tracking)
// get one too. The partial unique index `wealth_accounts_one_active_cash_idx`
// guarantees at most one active cash account per org, so a concurrent insert
// from a parallel request simply errors and is ignored.
async function ensureCashAccount(orgId: string, userId: string) {
  const [existing] = await db
    .select({ id: wealthAccounts.id })
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "cash"), isNull(wealthAccounts.archivedAt)))
  if (existing) return
  try {
    await db.insert(wealthAccounts).values({
      organizationId: orgId,
      type: "cash",
      bankName: "Cash in Hand",
      nickname: "",
      openingBalance: "0",
      currentBalance: "0",
      icon: "wallet",
      createdBy: userId,
      updatedBy: userId,
    })
  } catch {
    // Unique-index race: another request created the cash account first.
  }
}

function money(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

async function createSystemTransaction({
  orgId,
  userId,
  accountId,
  amount,
  type,
  description,
  category,
}: {
  orgId: string
  userId: string
  accountId: string
  amount: number
  type: "incoming" | "outgoing"
  description: string
  category: string
}) {
  if (amount <= 0) return
  const clientId = await ensureDefaultClient(orgId, userId)
  const today = new Date().toISOString().split("T")[0]
  const [row] = await db
    .insert(transactions)
    .values({
      clientId,
      wealthAccountId: accountId,
      type,
      amount: String(amount),
      description,
      category,
      date: today,
      isSystem: true,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  await logAudit({ orgId, entityType: "transaction", entityId: row.id, action: "create", actorId: userId })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method === "GET") {
    await ensureCashAccount(orgId, userId)
    // Due recurring occurrences must hit balances before the cards render.
    await materializeDueRecurring(orgId)
    const rows = await db
      .select({
        id: wealthAccounts.id,
        organizationId: wealthAccounts.organizationId,
        type: wealthAccounts.type,
        bankName: wealthAccounts.bankName,
        nickname: wealthAccounts.nickname,
        openingBalance: wealthAccounts.openingBalance,
        currentBalance: wealthAccounts.currentBalance,
        icon: wealthAccounts.icon,
        // Brand/detail fields for the cards + detail page. logo_data (base64) is
        // selected so the response can carry a durable `logo_src` data URL — the
        // hotlinked logo_url expires, the stored copy doesn't. The raw column is
        // stripped from the JSON below.
        brandDomain: wealthAccounts.brandDomain,
        logoUrl: wealthAccounts.logoUrl,
        logoData: wealthAccounts.logoData,
        country: wealthAccounts.country,
        accountNumber: wealthAccounts.accountNumber,
        routingNumber: wealthAccounts.routingNumber,
        swift: wealthAccounts.swift,
        address: wealthAccounts.address,
        location: wealthAccounts.location,
        note: wealthAccounts.note,
        creditLimit: wealthAccounts.creditLimit,
        statementClosingDay: wealthAccounts.statementClosingDay,
        paymentDueDay: wealthAccounts.paymentDueDay,
        position: wealthAccounts.position,
        isDefault: wealthAccounts.isDefault,
        archivedAt: wealthAccounts.archivedAt,
        createdAt: wealthAccounts.createdAt,
        updatedAt: wealthAccounts.updatedAt,
        transactionCount: count(transactions.id),
        attachmentCount: sql<number>`(select count(*)::int from wealth_account_attachments where wealth_account_id = ${wealthAccounts.id})`,
      })
      .from(wealthAccounts)
      .leftJoin(transactions, and(eq(transactions.wealthAccountId, wealthAccounts.id), isNull(transactions.deletedAt)))
      // Spaces (savings buckets) are managed on /spaces and must never appear as a
      // spendable account here (transaction pickers, transfer wizard, wealth list).
      // The server's transaction guard is the real boundary; this keeps them out of
      // every account UI in one place. Net worth re-adds the Spaces total on /wealth.
      .where(and(eq(wealthAccounts.organizationId, orgId), ne(wealthAccounts.type, "space")))
      .groupBy(wealthAccounts.id)
      // Active before archived, then the user's drag-to-reorder order
      // (`position`), falling back to creation order for ties (so never-reordered
      // workspaces keep Cash-in-Hand-first, banks oldest-first).
      .orderBy(
        sql`${wealthAccounts.archivedAt} is not null`,
        asc(wealthAccounts.position),
        asc(wealthAccounts.createdAt),
      )

    // Lazy heal: accounts whose logo bytes were never captured (fetch failed at
    // create time, or rows predating logo_data) get re-fetched here — bounded to
    // 3 per request and run in parallel so the list stays fast. Failures are
    // silent; the next GET simply retries.
    const missing = rows.filter((r) => !r.archivedAt && !r.logoData && (r.brandDomain || r.logoUrl)).slice(0, 3)
    if (missing.length) {
      await Promise.all(
        missing.map(async (r) => {
          const got = await fetchLogoData({ logoUrl: r.logoUrl || undefined, domain: r.brandDomain || undefined }).catch(() => null)
          if (!got) return
          r.logoData = got.logo_data
          r.logoUrl = got.logo_url
          await db
            .update(wealthAccounts)
            .set({ logoData: got.logo_data, logoUrl: got.logo_url, updatedAt: new Date() })
            .where(eq(wealthAccounts.id, r.id))
        }),
      )
    }

    return res.json(rows.map(({ logoData, ...rest }) => serialize({ ...rest, logoSrc: logoDataUrl(logoData) })))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const body = req.body as BankDetailInput & {
      type?: string
      bank_name?: string
      bankName?: string
      nickname?: string
      opening_balance?: number
      openingBalance?: number
      icon?: string
      // Credit card only (src/lib/credit-card.ts validateCardOnboarding):
      credit_limit?: number | string
      current_debt?: number | string
      statement_closing_day?: number
      payment_due_day?: number
      // Optional latest statement the user still knows ("I don't know" = omit).
      statement?: { balance?: number | string; closing_date?: string; due_date?: string } | null
    }
    const { type, nickname, icon } = body
    const bankName = body.bankName ?? body.bank_name ?? ""
    let openingBalance = body.openingBalance ?? body.opening_balance ?? 0
    if (type !== "bank" && type !== "cash" && type !== "credit_card") return res.status(400).json({ error: "type must be bank, cash or credit_card" })

    // A credit card is a LIABILITY: the amount owed is stored as a NEGATIVE
    // balance (see src/lib/credit-card.ts) and its "opening balance" is that
    // signed value, so the Opening Balance system row explains the debt.
    let card: { creditLimit: number; currentDebt: number; statementClosingDay: number; paymentDueDay: number; statement: { balance: number; closingDate: string; dueDate?: string } | null } | null = null
    if (type === "credit_card") {
      const name = bankName.trim()
      if (!name) return res.status(400).json({ error: "bank_name is required" })
      const st = body.statement && body.statement.closing_date
        ? { balance: Number(body.statement.balance ?? 0), closingDate: String(body.statement.closing_date), dueDate: body.statement.due_date ? String(body.statement.due_date) : undefined }
        : null
      card = {
        creditLimit: Number(body.credit_limit),
        currentDebt: Number(body.current_debt ?? 0),
        statementClosingDay: Number(body.statement_closing_day),
        paymentDueDay: Number(body.payment_due_day),
        statement: st,
      }
      const problem = validateCardOnboarding(card, todayIso())
      if (problem) return res.status(400).json({ error: `Invalid credit card: ${problem}` })
      if (amountExceedsLimit(card.creditLimit) || amountExceedsLimit(card.currentDebt)) return res.status(400).json({ error: "Amount is too large" })
      if (st && amountExceedsLimit(st.balance)) return res.status(400).json({ error: "Amount is too large" })
      if (st?.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(st.dueDate)) return res.status(400).json({ error: "statement.due_date must be YYYY-MM-DD" })
      const quota = await checkCreditCardQuota(orgId)
      if (!quota.allowed) return res.status(402).json(quota)
      openingBalance = signedBalanceFromDebt(card.currentDebt)
    }

    if (type === "bank") {
      const name = bankName.trim()
      if (!name) return res.status(400).json({ error: "bank_name is required" })
      // Plan-based: free workspaces get 1 bank account, paid plans are unlimited.
      const quota = await checkBankAccountQuota(orgId)
      if (!quota.allowed) return res.status(402).json(quota)
    }

    if (type === "cash") {
      const [{ total }] = await db
        .select({ total: count() })
        .from(wealthAccounts)
        .where(and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "cash"), isNull(wealthAccounts.archivedAt)))
      if (total >= 1) return res.status(400).json({ error: "Only one Cash in Hand account allowed" })
    }

    const opening = money(openingBalance)
    if (amountExceedsLimit(opening)) return res.status(400).json({ error: "Amount is too large" })
    // Bank-detail fields apply to bank + card accounts (Cash in Hand has none);
    // a card reuses the issuer brand/logo lookup.
    const details = type === "bank" || type === "credit_card" ? pickBankDetails(body) : null
    const logo = details ? await resolveLogoColumns(details.brandDomain, details.logoUrl) : null
    // Append new accounts after the user's existing order.
    const [{ maxPos }] = await db
      .select({ maxPos: max(wealthAccounts.position) })
      .from(wealthAccounts)
      .where(eq(wealthAccounts.organizationId, orgId))
    const [row] = await db
      .insert(wealthAccounts)
      .values({
        organizationId: orgId,
        type,
        bankName: type === "cash" ? "Cash in Hand" : bankName.trim(),
        nickname: (nickname ?? "").trim(),
        openingBalance: String(opening),
        currentBalance: String(opening),
        icon: icon || (type === "cash" ? "wallet" : type === "credit_card" ? "card" : "bank"),
        ...(card
          ? {
              creditLimit: String(card.creditLimit),
              statementClosingDay: card.statementClosingDay,
              paymentDueDay: card.paymentDueDay,
            }
          : {}),
        position: (maxPos ?? -1) + 1,
        ...(details ?? {}),
        ...(logo ? { logoUrl: logo.logoUrl, logoData: logo.logoData } : {}),
        createdBy: userId,
        updatedBy: userId,
      })
      .returning()

    if (opening !== 0) {
      // The Opening Balance row EXPLAINS the starting balance in the ledger: an
      // incoming for money held, an outgoing for money owed (a card's opening
      // debt, an overdrawn bank). System rows are not income/expense.
      await createSystemTransaction({
        orgId,
        userId,
        accountId: row.id,
        amount: Math.abs(opening),
        type: opening > 0 ? "incoming" : "outgoing",
        description: "Opening Balance",
        category: "Opening Balance",
      })
    }

    // A known latest statement seeds statement tracking (source='manual'); its
    // remaining amount is derived from payments dated after its close, so the
    // opening-debt system row above never counts as a payment.
    if (card?.statement) {
      const closingDate = card.statement.closingDate
      await db
        .insert(creditCardStatements)
        .values({
          organizationId: orgId,
          wealthAccountId: row.id,
          cycleStart: null,
          closingDate,
          dueDate: card.statement.dueDate ?? dueDateFor(closingDate, card.paymentDueDay),
          statementBalance: card.statement.balance.toFixed(2),
          source: "manual",
          createdBy: userId,
        })
        .onConflictDoNothing({ target: [creditCardStatements.wealthAccountId, creditCardStatements.closingDate] })
    }

    await logAudit({ orgId, entityType: "wealth_account", entityId: row.id, action: "create", actorId: userId })
    const { logoData, ...safe } = row
    return res.status(201).json(serialize({ ...safe, logoSrc: logoDataUrl(logoData) }))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
