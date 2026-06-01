import { and, count, desc, eq, isNull } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import {
  clients,
  plans,
  quotationAttachments,
  quotations,
  subscriptions,
  transactionAttachments,
  transactions,
} from "../../src/lib/db/schema.js"

export type PlanLimits = {
  clients?: number
  transactionsPerClient?: number
  quotations?: number
  attachmentSizeKb?: number
  attachmentsPerTx?: number
  noteLength?: number
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
}

const DEFAULT_PREMIUM_LIMITS: Required<PlanLimits> = {
  clients: 1000,
  transactionsPerClient: 10000,
  quotations: 10000,
  attachmentSizeKb: 10240,
  attachmentsPerTx: 10,
  noteLength: 100000,
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
    },
  }
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

export async function checkTransactionQuota(orgId: string, clientId: string): Promise<QuotaCheck> {
  const { planKey, limits } = await getOrgPlan(orgId)
  if (planKey !== "free") return { allowed: true }
  const [{ current }] = await db
    .select({ current: count() })
    .from(transactions)
    .where(eq(transactions.clientId, clientId))
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
  opts: { kind: "transaction"; parentId: string; sizeBytes: number } | { kind: "quotation"; parentId: string; sizeBytes: number },
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

  // Count existing attachments
  const table = opts.kind === "transaction" ? transactionAttachments : quotationAttachments
  const parentCol = opts.kind === "transaction" ? transactionAttachments.transactionId : quotationAttachments.quotationId
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
