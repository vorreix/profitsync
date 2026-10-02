import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db, serialize } from "../../../src/lib/db/index.js"
import { transfers, wealthAccounts } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"

const STATUSES = ["planned", "pending", "completed", "cancelled"] as const
const DEFAULT_STATUSES: string[] = ["planned", "pending"]
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const sourceAccounts = alias(wealthAccounts, "transfer_source_accounts")
const destinationAccounts = alias(wealthAccounts, "transfer_destination_accounts")
const reversals = alias(transfers, "transfer_reversals")

/**
 * GET /api/wealth/transfers — the org's logical transfers (the header rows, not
 * the ledger legs). Read-only; it never materialises money.
 *
 *   ?status=planned,pending   comma list (default: the two unsettled states)
 *   ?limit=50                 1..200
 *   ?include_trashed=true     also rows whose completed transfer sits in the trash
 *   ?group_id=<uuid>          the transfer that owns a given leg's group_id (the
 *                             detail modal resolves "Reverse transfer" this way
 *                             when a row predates transactions.transfer_id)
 *
 * Each row carries `source_account_name` / `destination_account_name` (nickname
 * or bank name) and `reversed_by_transfer_id` (the reversal that undid it, if any).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const q = req.query as Record<string, string | string[] | undefined>
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

  const rawStatus = one(q.status)
  const statuses = rawStatus
    ? rawStatus.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_STATUSES
  if (statuses.some((s) => !(STATUSES as readonly string[]).includes(s))) {
    return res.status(400).json({ error: `status must be a comma list of ${STATUSES.join(", ")}`, code: "invalid_transfer_status" })
  }

  const rawLimit = Number(one(q.limit) ?? DEFAULT_LIMIT)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT
  const includeTrashed = one(q.include_trashed) === "true"
  const groupId = one(q.group_id)
  if (groupId && !UUID_RE.test(groupId)) return res.status(400).json({ error: "group_id must be a uuid" })

  const conditions = [eq(transfers.organizationId, ctx.orgId), inArray(transfers.status, statuses)]
  if (!includeTrashed) conditions.push(isNull(transfers.deletedAt))
  if (groupId) conditions.push(eq(transfers.groupId, groupId))

  // Upcoming plans read soonest-first; history reads newest-first.
  const unsettledOnly = statuses.every((s) => s === "planned" || s === "pending")
  const order = unsettledOnly
    ? [asc(transfers.transferDate), asc(transfers.createdAt)]
    : [desc(transfers.transferDate), desc(transfers.createdAt)]

  const rows = await db
    .select({
      ...getTableColumns(transfers),
      sourceAccountName: sql<string>`coalesce(nullif(btrim(${sourceAccounts.nickname}), ''), ${sourceAccounts.bankName})`,
      destinationAccountName: sql<string>`coalesce(nullif(btrim(${destinationAccounts.nickname}), ''), ${destinationAccounts.bankName})`,
      reversedByTransferId: reversals.id,
    })
    .from(transfers)
    .innerJoin(sourceAccounts, eq(sourceAccounts.id, transfers.sourceAccountId))
    .innerJoin(destinationAccounts, eq(destinationAccounts.id, transfers.destinationAccountId))
    .leftJoin(reversals, and(eq(reversals.reversesTransferId, transfers.id), isNull(reversals.deletedAt)))
    .where(and(...conditions))
    .orderBy(...order)
    .limit(limit)

  return res.json({ transfers: rows.map((row) => serialize(row)) })
}
