import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, eq, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import { transactions, wealthAccounts } from "../../../../src/lib/db/schema.js"
import { canDelete, canWrite, ensureDefaultClient, requireAuth } from "../../../_lib/auth.js"
import { diffFields, logAudit } from "../../../_lib/audit.js"
import { type BankDetailInput, pickBankDetails, resolveLogoColumns } from "../../../_lib/bank-brand.js"
import { amountExceedsLimit } from "../../../../src/lib/money.js"
import { logoDataUrl } from "../../../../src/lib/logo-data.js"
import { checkBankAccountQuota } from "../../../_lib/quota.js"

function money(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// Swap the heavy base64 column for a durable `logo_src` data URL the client can
// render directly (the hotlinked logo_url expires; the stored copy doesn't).
function withLogoSrc<T extends { logoData?: unknown }>(row: T) {
  const { logoData, ...rest } = row
  return { ...rest, logoSrc: logoDataUrl(typeof logoData === "string" ? logoData : null) }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { id } = req.query as { id: string }

  const [account] = await db
    .select()
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.id, id), eq(wealthAccounts.organizationId, orgId)))
  if (!account) return res.status(404).json({ error: "Not found" })

  if (req.method === "GET") return res.json(serialize(withLogoSrc(account)))

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const body = req.body as BankDetailInput & {
      bank_name?: string
      bankName?: string
      nickname?: string
      icon?: string
      current_balance?: number
      currentBalance?: number
      archive?: boolean
      restore?: boolean
      set_default?: boolean
    }
    const { nickname, icon, archive, restore } = body
    const setDefault = typeof body.set_default === "boolean" ? body.set_default : undefined
    const bankName = body.bankName ?? body.bank_name
    const currentBalance = body.currentBalance ?? body.current_balance
    if (currentBalance !== undefined && amountExceedsLimit(currentBalance)) return res.status(400).json({ error: "Amount is too large" })

    // Bank-detail fields are only updated when at least one is present in the
    // body (so a plain rename/adjust PATCH doesn't wipe them). Logo is re-fetched
    // only when the brand domain / logo url is part of this update.
    const hasDetailUpdate = ["brand_domain", "logo_url", "country", "account_number", "routing_number", "swift", "address", "location", "note"]
      .some((k) => k in (body as Record<string, unknown>))
    const details = account.type === "bank" && hasDetailUpdate ? pickBankDetails(body) : null
    const logo = details && ("brand_domain" in body || "logo_url" in body)
      ? await resolveLogoColumns(details.brandDomain, details.logoUrl)
      : null

    // Cash in Hand is the default account and must always exist — it can be
    // renamed/re-iconed and have its balance adjusted, but never archived.
    if (archive && account.type === "cash") {
      return res.status(400).json({ error: "Cash in Hand can't be archived" })
    }

    if (account.type === "bank" && bankName !== undefined && !bankName.trim()) {
      return res.status(400).json({ error: "bankName is required" })
    }
    if (icon !== undefined && !icon.trim()) {
      return res.status(400).json({ error: "icon is required" })
    }

    if (restore && account.archivedAt) {
      if (account.type === "cash") {
        const [{ total }] = await db
          .select({ total: count() })
          .from(wealthAccounts)
          .where(and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "cash"), isNull(wealthAccounts.archivedAt)))
        if (total >= 1) return res.status(400).json({ error: "Cash in Hand already exists" })
      }
      if (account.type === "bank") {
        // Reopening: free plans block if already at the 1-active limit (forcing an
        // upgrade); paid plans always allow (the bank already counts toward 20).
        const quota = await checkBankAccountQuota(orgId, { forRestore: true })
        if (!quota.allowed) return res.status(402).json(quota)
      }
    }

    // Default flip. Two steps — clear, then set — because a single UPDATE that
    // flips both rows can transiently hold two `true` entries (row order is
    // unspecified) and trip the one-active-default unique index. The in-between
    // state (no default) is benign; selectors fall back to Cash.
    if (setDefault === true) {
      if (account.archivedAt) return res.status(400).json({ error: "Restore the account before making it default" })
      await db
        .update(wealthAccounts)
        .set({ isDefault: false, updatedBy: userId, updatedAt: new Date() })
        .where(and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.isDefault, true), sql`${wealthAccounts.id} != ${id}`))
      await db
        .update(wealthAccounts)
        .set({ isDefault: true, updatedBy: userId, updatedAt: new Date() })
        .where(and(eq(wealthAccounts.id, id), eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
    } else if (setDefault === false) {
      await db
        .update(wealthAccounts)
        .set({ isDefault: false, updatedBy: userId, updatedAt: new Date() })
        .where(and(eq(wealthAccounts.id, id), eq(wealthAccounts.organizationId, orgId)))
    }

    const [before] = await db.select().from(wealthAccounts).where(eq(wealthAccounts.id, id))
    const oldBalance = money(before.currentBalance)
    const newBalance = currentBalance !== undefined ? money(currentBalance) : oldBalance
    const delta = newBalance - oldBalance

    if (delta !== 0) {
      const clientId = await ensureDefaultClient(orgId, userId)
      const txType = delta > 0 ? "incoming" : "outgoing"
      const [tx] = await db
        .insert(transactions)
        .values({
          clientId,
          wealthAccountId: id,
          type: txType,
          amount: String(Math.abs(delta)),
          description: "Balance Adjustment",
          category: "Adjustment",
          date: new Date().toISOString().split("T")[0],
          isSystem: true,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning()
      await logAudit({ orgId, entityType: "transaction", entityId: tx.id, action: "create", actorId: userId })
    }

    const [updated] = await db
      .update(wealthAccounts)
      .set({
        ...(bankName !== undefined ? { bankName: bankName.trim() || "Cash in Hand" } : {}),
        ...(nickname !== undefined ? { nickname: nickname.trim() } : {}),
        ...(icon !== undefined ? { icon } : {}),
        ...(currentBalance !== undefined ? { currentBalance: String(newBalance) } : {}),
        ...(details ?? {}),
        ...(logo ? { logoUrl: logo.logoUrl, logoData: logo.logoData } : {}),
        // Archiving or restoring clears the default flag (an archived default is
        // meaningless, and restoring while another default exists would violate
        // the one-active-default index).
        ...(archive ? { archivedAt: new Date(), isDefault: false } : {}),
        ...(restore ? { archivedAt: null, isDefault: false } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(wealthAccounts.id, id))
      .returning()

    const changes = diffFields(
      before as Record<string, unknown>,
      updated as Record<string, unknown>,
      ["bankName", "nickname", "icon", "currentBalance", "archivedAt", "isDefault", "country", "accountNumber", "routingNumber", "swift", "address", "location", "note"],
    )
    if (Object.keys(changes).length) {
      await logAudit({ orgId, entityType: "wealth_account", entityId: id, action: archive ? "close" : restore ? "reopen" : "update", actorId: userId, changes })
    }
    return res.json(serialize(withLogoSrc(updated)))
  }

  if (req.method === "DELETE") {
    // Matches the other entity DELETEs (owner/admin only). Editors can still
    // CLOSE an account via PATCH { archive: true }.
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    // Cash in Hand is permanent — never deleted or archived.
    if (account.type === "cash") {
      return res.status(400).json({ error: "Cash in Hand can't be removed" })
    }
    const [{ total }] = await db
      .select({ total: count() })
      .from(transactions)
      .where(and(eq(transactions.wealthAccountId, id), isNull(transactions.deletedAt)))

    if (total > 0) {
      const [updated] = await db
        .update(wealthAccounts)
        .set({ archivedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
        .where(eq(wealthAccounts.id, id))
        .returning()
      await logAudit({ orgId, entityType: "wealth_account", entityId: id, action: "close", actorId: userId })
      return res.json(serialize(withLogoSrc(updated)))
    }

    await db.delete(wealthAccounts).where(eq(wealthAccounts.id, id))
    await logAudit({ orgId, entityType: "wealth_account", entityId: id, action: "delete", actorId: userId })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
