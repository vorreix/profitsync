import { and, count, desc, eq, isNull, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import {
  clientAttachments,
  clients,
  plans,
  quotationAttachments,
  quotations,
  subscriptions,
  transactionAttachments,
  transactions,
  wealthAccountAttachments,
  wealthAccounts,
} from "../../src/lib/db/schema.js"

export type PlanLimits = {
  clients?: number
  transactionsPerClient?: number
  quotations?: number
  attachmentSizeKb?: number
  attachmentsPerTx?: number
  noteLength?: number
  // Org-wide ceiling on the total size of all attachments combined (anti-abuse).
  attachmentTotalSizeKb?: number
  // Max bank accounts (Cash in Hand is always free + doesn't count). Free = 1.
  bankAccounts?: number
  // Max personal savings Spaces (type='space'). Free = 1, paid personal = 7.
  spaces?: number
}

export type QuotaCheck =
  | { allowed: true }
  | { allowed: false; reason: string; limit: number; current?: number; upgradeHint: boolean }

const DEFAULT_FREE_LIMITS: Required<PlanLimits> = {
  clients: 10,
  transactionsPerClient: 30,
  quotations: 30,
  attachmentSizeKb: 1024,
  attachmentsPerTx: 1,
  noteLength: 200,
  attachmentTotalSizeKb: 50 * 1024, // 50 MB across the whole workspace
  bankAccounts: 1, // free workspaces get a single bank account (+ Cash in Hand)
  spaces: 1, // free personal accounts get a single savings Space
}

const DEFAULT_PREMIUM_LIMITS: Required<PlanLimits> = {
  clients: 1000,
  transactionsPerClient: 10000,
  quotations: 10000,
  attachmentSizeKb: 10240,
  attachmentsPerTx: 10,
  noteLength: 100000,
  attachmentTotalSizeKb: 5 * 1024 * 1024, // 5 GB across the whole workspace
  bankAccounts: 20, // paid plans: up to 20 bank accounts INCLUDING closed ones
  spaces: 7, // paid personal plan includes 7 savings Spaces
}

export async function getOrgPlan(orgId: string): Promise<{ planKey: string; limits: Required<PlanLimits> }> {
  // The plan that applies depends on the subscription's plan_key, but the plans
  // table is tiny (free/premium), so fetch the subscription and all plans
  // concurrently and resolve in memory — one parallel batch instead of two
  // sequential neon-http round-trips.
  const [subRows, planRows] = await Promise.all([
    db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, orgId))
      .orderBy(desc(subscriptions.updatedAt))
      .limit(1),
    db.select().from(plans),
  ])

  const sub = subRows[0]
  // Entitled while active/trialing, and during the grace period after a cancellation
  // (cancel takes effect at period end, so honor the plan until cancelAt).
  const inGracePeriod =
    sub?.status === "cancelled" && sub.cancelAt != null && new Date(sub.cancelAt) > new Date()
  const entitled = sub?.status === "active" || sub?.status === "trialing" || inGracePeriod
  const planKey = entitled ? (sub.planKey ?? "free") : "free"

  const plan = planRows.find((p) => p.key === planKey)
  // Any paid plan defaults to generous limits when a specific field is unset.
  const fallback = planKey === "free" ? DEFAULT_FREE_LIMITS : DEFAULT_PREMIUM_LIMITS
  const stored = (plan?.limits as PlanLimits | undefined) ?? {}

  return {
    planKey,
    limits: {
      clients: stored.clients ?? fallback.clients,
      transactionsPerClient: stored.transactionsPerClient ?? fallback.transactionsPerClient,
      quotations: stored.quotations ?? fallback.quotations,
      attachmentSizeKb: stored.attachmentSizeKb ?? fallback.attachmentSizeKb,
      attachmentsPerTx: stored.attachmentsPerTx ?? fallback.attachmentsPerTx,
      noteLength: stored.noteLength ?? fallback.noteLength,
      attachmentTotalSizeKb: stored.attachmentTotalSizeKb ?? fallback.attachmentTotalSizeKb,
      bankAccounts: stored.bankAccounts ?? fallback.bankAccounts,
      spaces: stored.spaces ?? fallback.spaces,
    },
  }
}

// Org-wide guard: the combined size of ALL attachments (client docs +
// transaction + quotation) in the workspace must stay under the plan ceiling.
// This is the backstop against spam/storage abuse — per-parent limits alone
// don't bound the total, since a user can create many parents.
export async function checkOrgAttachmentQuota(orgId: string, newSizeBytes: number): Promise<QuotaCheck> {
  const { planKey, limits } = await getOrgPlan(orgId)
  const maxBytes = limits.attachmentTotalSizeKb * 1024

  const sumExpr = sql<number>`coalesce(sum(${transactionAttachments.fileSize}), 0)`
  const [clientSum, txSum, quotationSum, wealthSum] = await Promise.all([
    db
      .select({ total: sql<number>`coalesce(sum(${clientAttachments.fileSize}), 0)` })
      .from(clientAttachments)
      .innerJoin(clients, eq(clients.id, clientAttachments.clientId))
      .where(eq(clients.organizationId, orgId)),
    db
      .select({ total: sumExpr })
      .from(transactionAttachments)
      .innerJoin(transactions, eq(transactions.id, transactionAttachments.transactionId))
      .innerJoin(clients, eq(clients.id, transactions.clientId))
      .where(eq(clients.organizationId, orgId)),
    db
      .select({ total: sql<number>`coalesce(sum(${quotationAttachments.fileSize}), 0)` })
      .from(quotationAttachments)
      .innerJoin(quotations, eq(quotations.id, quotationAttachments.quotationId))
      .where(eq(quotations.organizationId, orgId)),
    db
      .select({ total: sql<number>`coalesce(sum(${wealthAccountAttachments.fileSize}), 0)` })
      .from(wealthAccountAttachments)
      .innerJoin(wealthAccounts, eq(wealthAccounts.id, wealthAccountAttachments.wealthAccountId))
      .where(eq(wealthAccounts.organizationId, orgId)),
  ])

  const used = Number(clientSum[0]?.total ?? 0) + Number(txSum[0]?.total ?? 0) + Number(quotationSum[0]?.total ?? 0) + Number(wealthSum[0]?.total ?? 0)
  if (used + newSizeBytes > maxBytes) {
    return {
      allowed: false,
      reason: `Your workspace has reached its ${(maxBytes / (1024 * 1024)).toFixed(0)}MB attachment storage limit${planKey === "free" ? ". Upgrade to Premium for more." : "."}`,
      limit: maxBytes,
      current: used,
      upgradeHint: planKey === "free",
    }
  }
  return { allowed: true }
}

export async function checkClientQuota(orgId: string): Promise<QuotaCheck> {
  const { planKey, limits } = await getOrgPlan(orgId)
  if (planKey !== "free") return { allowed: true }
  // The auto-provisioned own/internal client doesn't count against the quota.
  const [{ current }] = await db
    .select({ current: count() })
    .from(clients)
    .where(and(eq(clients.organizationId, orgId), isNull(clients.deletedAt), eq(clients.isOwn, false)))
  if (current >= limits.clients) {
    return {
      allowed: false,
      reason: `Free plan is limited to ${limits.clients} clients. Upgrade to Premium to add more.`,
      limit: limits.clients,
      current,
      upgradeHint: true,
    }
  }
  return { allowed: true }
}

/**
 * Bank-account allowance. Cash in Hand never counts.
 *  • FREE: 1 ACTIVE bank at a time. Closing one frees the slot (so you can add
 *    another), but reopening a closed bank while already at the active limit is
 *    blocked → must upgrade.
 *  • PAID: up to 20 banks TOTAL, INCLUDING closed ones (so the full history is
 *    kept). Reopening doesn't add to the total, so it's never blocked by the cap.
 */
export async function checkBankAccountQuota(orgId: string, opts: { forRestore?: boolean } = {}): Promise<QuotaCheck> {
  const { planKey, limits } = await getOrgPlan(orgId)
  const isFree = planKey === "free"

  // Paid plans cap TOTAL banks; restoring an already-counted bank can't exceed it.
  if (!isFree && opts.forRestore) return { allowed: true }

  const where = isFree
    ? and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "bank"), isNull(wealthAccounts.archivedAt))
    : and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "bank"))
  const [{ current }] = await db.select({ current: count() }).from(wealthAccounts).where(where)

  if (current >= limits.bankAccounts) {
    return {
      allowed: false,
      reason: isFree
        ? (opts.forRestore
            ? "Free plan allows 1 active bank account. Upgrade to Premium to reopen this one."
            : "Free plan includes 1 bank account. Upgrade to Premium for up to 20.")
        : `This workspace has reached its limit of ${limits.bankAccounts} bank accounts (including closed ones).`,
      limit: limits.bankAccounts,
      current,
      upgradeHint: isFree,
    }
  }
  return { allowed: true }
}

/** Count of bank accounts that counts toward the plan limit (free: active; paid: total incl. closed). */
export async function bankAccountUsage(orgId: string): Promise<{ planKey: string; current: number; limit: number }> {
  const { planKey, limits } = await getOrgPlan(orgId)
  const where = planKey === "free"
    ? and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "bank"), isNull(wealthAccounts.archivedAt))
    : and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "bank"))
  const [{ current }] = await db.select({ current: count() }).from(wealthAccounts).where(where)
  return { planKey, current, limit: limits.bankAccounts }
}

// Limit the number of (active) savings Spaces per workspace. Spaces are a
// personal-profile feature; free personal = 1, paid personal = 7. Counts only
// active type='space' rows (archived Spaces free up a slot, like bank accounts).
export async function checkSpaceQuota(orgId: string): Promise<QuotaCheck> {
  const { planKey, limits } = await getOrgPlan(orgId)
  const [{ current }] = await db
    .select({ current: count() })
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "space"), isNull(wealthAccounts.archivedAt)))
  if (current >= limits.spaces) {
    return {
      allowed: false,
      reason:
        planKey === "free"
          ? "Free plan includes 1 savings Space. Upgrade to Premium for up to 7."
          : `This workspace has reached its limit of ${limits.spaces} Spaces.`,
      limit: limits.spaces,
      current,
      upgradeHint: planKey === "free",
    }
  }
  return { allowed: true }
}

export async function checkTransactionQuota(orgId: string, clientId: string): Promise<QuotaCheck> {
  const { planKey, limits } = await getOrgPlan(orgId)
  if (planKey !== "free") return { allowed: true }
  // Count only user-created transactions. System rows (wealth opening-balance and
  // balance-adjustment ledger entries — `isSystem = true`, set server-side only)
  // are internal, off-P&L bookkeeping and are exempt from the per-client quota,
  // matching the Space-transfer exemption in wealth/transfer.ts. Counting them
  // both let a free org self-lock-out and made the limit inconsistent.
  const [{ current }] = await db
    .select({ current: count() })
    .from(transactions)
    .where(
      and(eq(transactions.clientId, clientId), isNull(transactions.deletedAt), eq(transactions.isSystem, false)),
    )
  if (current >= limits.transactionsPerClient) {
    return {
      allowed: false,
      reason: `Free plan is limited to ${limits.transactionsPerClient} transactions per client. Upgrade to Premium.`,
      limit: limits.transactionsPerClient,
      current,
      upgradeHint: true,
    }
  }
  return { allowed: true }
}

export async function checkQuotationQuota(orgId: string): Promise<QuotaCheck> {
  const { planKey, limits } = await getOrgPlan(orgId)
  if (planKey !== "free") return { allowed: true }
  const [{ current }] = await db
    .select({ current: count() })
    .from(quotations)
    .where(and(eq(quotations.organizationId, orgId), isNull(quotations.deletedAt)))
  if (current >= limits.quotations) {
    return {
      allowed: false,
      reason: `Free plan is limited to ${limits.quotations} quotations. Upgrade to Premium.`,
      limit: limits.quotations,
      current,
      upgradeHint: true,
    }
  }
  return { allowed: true }
}

export async function checkAttachmentQuota(
  orgId: string,
  opts: { kind: "transaction" | "quotation" | "client" | "wealth_account"; parentId: string; sizeBytes: number },
): Promise<QuotaCheck> {
  const { planKey, limits } = await getOrgPlan(orgId)
  const maxBytes = limits.attachmentSizeKb * 1024
  if (opts.sizeBytes > maxBytes) {
    return {
      allowed: false,
      reason: `Attachment exceeds ${(limits.attachmentSizeKb / 1024).toFixed(1)}MB limit for ${planKey} plan.`,
      limit: maxBytes,
      current: opts.sizeBytes,
      upgradeHint: planKey === "free",
    }
  }

  // Count existing attachments for this parent.
  const { table, parentCol } =
    opts.kind === "transaction"
      ? { table: transactionAttachments, parentCol: transactionAttachments.transactionId }
      : opts.kind === "quotation"
        ? { table: quotationAttachments, parentCol: quotationAttachments.quotationId }
        : opts.kind === "wealth_account"
          ? { table: wealthAccountAttachments, parentCol: wealthAccountAttachments.wealthAccountId }
          : { table: clientAttachments, parentCol: clientAttachments.clientId }
  const [{ current }] = await db
    .select({ current: count() })
    .from(table)
    .where(eq(parentCol, opts.parentId))

  if (current >= limits.attachmentsPerTx) {
    return {
      allowed: false,
      reason: `${planKey === "free" ? "Free" : "Premium"} plan is limited to ${limits.attachmentsPerTx} attachments per ${opts.kind}.`,
      limit: limits.attachmentsPerTx,
      current,
      upgradeHint: planKey === "free",
    }
  }
  return { allowed: true }
}

export async function checkNoteLength(orgId: string, content: string | undefined | null): Promise<QuotaCheck> {
  if (!content) return { allowed: true }
  const { limits, planKey } = await getOrgPlan(orgId)
  if (content.length <= limits.noteLength) return { allowed: true }
  return {
    allowed: false,
    reason: `${planKey === "free" ? "Free" : "Premium"} plan allows ${limits.noteLength} characters per note. Yours has ${content.length}.`,
    limit: limits.noteLength,
    current: content.length,
    upgradeHint: planKey === "free",
  }
}
