import type { VercelRequest, VercelResponse } from "@vercel/node"
import { randomUUID } from "node:crypto"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clients, organizations, organizationMembers, transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { ensureDefaultClient, ensurePersonalOrg, getUserFamilyOrgId, getUserId } from "../../_lib/auth.js"
import { logAudit } from "../../_lib/audit.js"
import { amountExceedsLimit } from "../../../src/lib/money.js"
import { isHead } from "../../../src/lib/family.js"
import { reversalsByAccount } from "../../../src/lib/wealth-ledger.js"

type Direction = "contribute" | "withdraw" | "disburse"

type LoadedAccount = {
  id: string
  type: string
  nickname: string
  bankName: string
  organizationId: string
  ownerUserId: string
  isPersonal: boolean
  accountType: string | null
  currency: string
}

const displayName = (a: { nickname: string; bankName: string; type: string }) =>
  a.nickname.trim() || a.bankName || (a.type === "cash" ? "Cash" : "Account")

async function loadAccount(accountId: string): Promise<LoadedAccount | null> {
  const [row] = await db
    .select({
      id: wealthAccounts.id,
      type: wealthAccounts.type,
      nickname: wealthAccounts.nickname,
      bankName: wealthAccounts.bankName,
      organizationId: wealthAccounts.organizationId,
      archivedAt: wealthAccounts.archivedAt,
      ownerUserId: organizations.ownerUserId,
      isPersonal: organizations.isPersonal,
      accountType: organizations.accountType,
      currency: organizations.currency,
    })
    .from(wealthAccounts)
    .innerJoin(organizations, eq(organizations.id, wealthAccounts.organizationId))
    .where(eq(wealthAccounts.id, accountId))
  if (!row || row.archivedAt) return null
  const { archivedAt: _omit, ...rest } = row
  return rest
}

/** The recipient's default personal account (is_default, else Cash, else first). */
async function recipientDefaultAccount(personalOrgId: string): Promise<LoadedAccount | null> {
  const rows = await db
    .select({ id: wealthAccounts.id, type: wealthAccounts.type, isDefault: wealthAccounts.isDefault })
    .from(wealthAccounts)
    .where(
      and(
        eq(wealthAccounts.organizationId, personalOrgId),
        isNull(wealthAccounts.archivedAt),
        sql`${wealthAccounts.type} <> 'space'`,
      ),
    )
    .orderBy(desc(wealthAccounts.isDefault), desc(wealthAccounts.type)) // default first, then 'cash' before 'bank'
  const pick = rows[0]
  return pick ? loadAccount(pick.id) : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  if (req.method === "DELETE") return handleDelete(req, res, userId)
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const body = req.body as {
    direction?: Direction
    from_account_id?: string
    to_account_id?: string
    to_member_id?: string
    amount?: number | string
    dest_amount?: number | string
    date?: string
    note?: string
  }
  const direction = body.direction
  if (direction !== "contribute" && direction !== "withdraw" && direction !== "disburse") {
    return res.status(400).json({ error: "direction must be contribute, withdraw, or disburse" })
  }

  const amt = Number(body.amount)
  if (!amt || isNaN(amt) || amt <= 0) return res.status(400).json({ error: "amount must be greater than 0" })
  if (amountExceedsLimit(amt)) return res.status(400).json({ error: "Amount is too large" })

  const familyOrgId = await getUserFamilyOrgId(userId)
  if (!familyOrgId) return res.status(400).json({ error: "You're not part of a family yet.", code: "no_family" })

  // Resolve source + destination accounts per direction, enforcing ownership and
  // family membership. `party` is the member the flow is attributed to.
  let from: LoadedAccount | null = null
  let to: LoadedAccount | null = null
  let party = userId

  if (direction === "contribute") {
    from = body.from_account_id ? await loadAccount(body.from_account_id) : null
    to = body.to_account_id ? await loadAccount(body.to_account_id) : null
    if (!from || !to) return res.status(400).json({ error: "Select an active source and destination account" })
    if (!(from.isPersonal && from.ownerUserId === userId)) {
      return res.status(403).json({ error: "You can only contribute from your own personal account" })
    }
    if (to.organizationId !== familyOrgId) return res.status(403).json({ error: "Destination must be a family account" })
  } else if (direction === "withdraw") {
    from = body.from_account_id ? await loadAccount(body.from_account_id) : null
    to = body.to_account_id ? await loadAccount(body.to_account_id) : null
    if (!from || !to) return res.status(400).json({ error: "Select an active source and destination account" })
    if (from.organizationId !== familyOrgId) return res.status(403).json({ error: "Source must be a family account" })
    if (!(to.isPersonal && to.ownerUserId === userId)) {
      return res.status(403).json({ error: "You can only withdraw to your own personal account" })
    }
  } else {
    // disburse: head only; recipient chosen by member (never by their account).
    const [callerMembership] = await db
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, familyOrgId), eq(organizationMembers.userId, userId)))
    if (!callerMembership || !isHead(callerMembership.role)) {
      return res.status(403).json({ error: "Only the head of the family can send money to members" })
    }
    const recipientId = body.to_member_id
    if (!recipientId) return res.status(400).json({ error: "to_member_id is required" })
    const [recipientMembership] = await db
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, familyOrgId), eq(organizationMembers.userId, recipientId)))
    if (!recipientMembership) return res.status(404).json({ error: "Recipient is not a family member" })

    from = body.from_account_id ? await loadAccount(body.from_account_id) : null
    if (!from || from.organizationId !== familyOrgId) {
      return res.status(403).json({ error: "Source must be a family account" })
    }
    // Resolve the recipient's default PERSONAL account server-side; the head never
    // sees the recipient's accounts (privacy).
    const recipientPersonalOrgId = await ensurePersonalOrg(recipientId)
    to = await recipientDefaultAccount(recipientPersonalOrgId)
    if (!to) return res.status(409).json({ error: "Recipient has no personal account to receive money" })
    party = recipientId
  }

  if (from.id === to.id) return res.status(400).json({ error: "Choose two different accounts" })
  if (from.type === "space" && to.type === "space") {
    return res.status(400).json({ error: "Move money through an account, not space-to-space" })
  }

  // Currency: each leg records its own org-currency amount. Same currency → equal;
  // differing currencies require an explicit dest_amount (no silent FX).
  const sameCurrency = from.currency === to.currency
  let destAmt = amt
  if (!sameCurrency) {
    destAmt = Number(body.dest_amount)
    if (!destAmt || isNaN(destAmt) || destAmt <= 0 || amountExceedsLimit(destAmt)) {
      return res.status(400).json({
        error: `Enter the amount received in ${to.currency} (the family and your account use different currencies).`,
        code: "currency_mismatch",
        from_currency: from.currency,
        to_currency: to.currency,
      })
    }
  }

  const fromClientId = await ensureDefaultClient(from.organizationId, userId)
  const toClientId = await ensureDefaultClient(to.organizationId, userId)

  const familyName =
    (from.accountType === "family" ? displayNameOrg(from) : to.accountType === "family" ? displayNameOrg(to) : "family")
  const noteText = (body.note ?? "").trim()
  const suffix = noteText ? ` — ${noteText}` : ""
  const outDesc =
    direction === "contribute"
      ? `Contribution to ${familyName}${suffix}`
      : direction === "disburse"
        ? `Family payment${suffix}`
        : `Withdrawal from ${familyName}${suffix}`
  const inDesc =
    direction === "contribute"
      ? `Contribution from a member${suffix}`
      : direction === "disburse"
        ? `From ${familyName}${suffix}`
        : `Withdrawal to ${displayName(to)}${suffix}`

  const when = body.date ?? new Date().toISOString().split("T")[0]
  const groupId = randomUUID()
  const category = "Family transfer"

  const [outLeg] = await db
    .insert(transactions)
    .values({
      clientId: fromClientId,
      wealthAccountId: from.id,
      groupId,
      kind: "transfer",
      type: "outgoing",
      amount: String(amt),
      description: outDesc,
      category,
      date: when,
      familyTransfer: true,
      familyPartyUserId: party,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  const [inLeg] = await db
    .insert(transactions)
    .values({
      clientId: toClientId,
      wealthAccountId: to.id,
      groupId,
      kind: "transfer",
      type: "incoming",
      amount: String(destAmt),
      description: inDesc,
      category,
      date: when,
      familyTransfer: true,
      familyPartyUserId: party,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()

  await db
    .update(wealthAccounts)
    .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric - ${amt}`, updatedBy: userId, updatedAt: new Date() })
    .where(eq(wealthAccounts.id, from.id))
  await db
    .update(wealthAccounts)
    .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${destAmt}`, updatedBy: userId, updatedAt: new Date() })
    .where(eq(wealthAccounts.id, to.id))

  await logAudit({ orgId: from.organizationId, entityType: "transaction", entityId: outLeg.id, action: "create", actorId: userId })
  await logAudit({ orgId: to.organizationId, entityType: "transaction", entityId: inLeg.id, action: "create", actorId: userId })

  return res.status(201).json({ group_id: groupId, from_leg: serialize(outLeg), to_leg: serialize(inLeg), attach_to: outLeg.id })
}

const displayNameOrg = (a: LoadedAccount): string => a.nickname.trim() || a.bankName || "family"

/**
 * Undo a family transfer: reverse BOTH legs' balances across BOTH orgs and remove
 * the legs. Found by group_id. Delete is final (no Trash) to keep cross-org
 * balances consistent. Permission: head of the family, or the member the flow is
 * attributed to.
 */
async function handleDelete(req: VercelRequest, res: VercelResponse, userId: string) {
  const groupId = (req.query.group_id as string | undefined)?.trim() || (req.body as { group_id?: string })?.group_id
  if (!groupId) return res.status(400).json({ error: "group_id is required" })

  const legs = await db
    .select({
      id: transactions.id,
      type: transactions.type,
      amount: transactions.amount,
      wealthAccountId: transactions.wealthAccountId,
      familyTransfer: transactions.familyTransfer,
      familyPartyUserId: transactions.familyPartyUserId,
      orgId: clients.organizationId,
      accountType: organizations.accountType,
    })
    .from(transactions)
    .innerJoin(clients, eq(clients.id, transactions.clientId))
    .innerJoin(organizations, eq(organizations.id, clients.organizationId))
    .where(and(eq(transactions.groupId, groupId), isNull(transactions.deletedAt)))

  const familyLegs = legs.filter((l) => l.familyTransfer)
  if (!familyLegs.length) return res.status(404).json({ error: "Family transfer not found" })

  const familyLeg = familyLegs.find((l) => l.accountType === "family")
  const familyOrgId = familyLeg?.orgId
  const party = familyLegs[0].familyPartyUserId
  if (!familyOrgId) return res.status(404).json({ error: "Family transfer not found" })

  // Permission: caller must be in the family, and either its head or the member
  // the flow is attributed to.
  const [membership] = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, familyOrgId), eq(organizationMembers.userId, userId)))
  if (!membership) return res.status(403).json({ error: "Forbidden" })
  if (!isHead(membership.role) && party !== userId) {
    return res.status(403).json({ error: "Only the head or the member involved can undo this transfer" })
  }

  // Reverse both balances (account-keyed, so cross-org legs collapse correctly).
  const shifts = reversalsByAccount(familyLegs)
  for (const [accountId, delta] of shifts) {
    await db
      .update(wealthAccounts)
      .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${delta}`, updatedBy: userId, updatedAt: new Date() })
      .where(eq(wealthAccounts.id, accountId))
  }

  for (const leg of familyLegs) {
    await db.delete(transactions).where(eq(transactions.id, leg.id))
  }

  return res.status(204).end()
}
