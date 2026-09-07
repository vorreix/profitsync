import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, count, eq, isNull, ne, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../_lib/auth.js"
import { fetchLogoData } from "../../_lib/bank-brand.js"
import { logoDataUrl } from "../../../src/lib/logo-data.js"
import { materializeDueRecurring } from "../../_lib/recurring-materialize.js"
import { createWealthAccount, type CreateAccountInput } from "../../_lib/wealth-accounts.js"
import { syncCards } from "../../_lib/card-autopay.js"

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method === "GET") {
    await ensureCashAccount(orgId, userId)
    // Due recurring occurrences must hit balances before the cards render, and
    // due card autopays must have moved money (card-autopay.ts is idempotent
    // and short-circuits cheaply when nothing is due).
    await materializeDueRecurring(orgId)
    await syncCards(orgId).catch((err) => console.error("[cards] sync failed", err))
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
        // How many non-closed cards live on this account (debit cards on a bank,
        // the one credit card on a liability account) — the Banks tab badge.
        // Cards this account is involved with, counting BOTH relationships the
        // card overlay shows: the cards whose money IS this account (a debit
        // card on a bank), the credit cards this account PAYS, and the credit
        // cards this bank ISSUED. Counting fewer would make the tile badge
        // disagree with the overlay (see components/cards/bank-cards.ts).
        cardCount: sql<number>`(
          select count(*)::int from cards c
          where c.status <> 'closed'
            and (c.account_id = ${wealthAccounts.id}
                 or (c.kind = 'credit' and c.funding_account_id = ${wealthAccounts.id})
                 or (c.kind = 'credit' and c.issuer_account_id = ${wealthAccounts.id}))
        )`,
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
    // Validation, quota, brand logo, the Opening Balance system row and a card's
    // seed statement all live in api/_lib/wealth-accounts.ts — shared with the
    // Cards API so an inline "add bank" behaves exactly like this route.
    const result = await createWealthAccount(orgId, userId, req.body as CreateAccountInput)
    if (!result.ok) return res.status(result.status).json(result.body)
    const { logoData, ...safe } = result.row
    return res.status(201).json(serialize({ ...safe, logoSrc: logoDataUrl(logoData) }))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
