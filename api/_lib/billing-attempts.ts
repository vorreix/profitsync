// Billing-attempt logging — the observability layer for checkout.
//
// Every paid-plan subscribe click writes a billing_attempts row and later events
// (checkout created, webhook payment results, return-from-checkout reconcile)
// advance its status. Follows the audit-log pattern: ALL writes are non-fatal
// (errors swallowed) because observability must never break the money path.
//
// Status lifecycle:  created → redirected → completed | failed
// `failed → completed` is allowed (a retried/dunning-recovered payment), every
// other terminal state is final. Stale created/redirected rows are *displayed*
// as abandoned by the admin panel (effectiveStatus) — no mutation job needed.

import { desc, eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { billingAttempts } from "../../src/lib/db/schema.js"

export type AttemptStatus = "created" | "redirected" | "completed" | "failed" | "abandoned"

export const ATTEMPT_STATUSES: readonly AttemptStatus[] = ["created", "redirected", "completed", "failed", "abandoned"]
export const FOLLOW_UP_STATUSES = ["none", "contacted", "resolved", "paid_later"] as const
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number]

const TERMINAL = new Set<string>(["completed", "failed", "abandoned"])

/** Pure transition guard — idempotent webhooks/retries can't regress a status. */
export function canTransition(from: string, to: AttemptStatus): boolean {
  if (from === to) return false
  if (!TERMINAL.has(from)) return true
  // A recorded failure can still convert later (payment retry / dunning
  // recovery). Nothing else leaves a terminal state.
  return from === "failed" && to === "completed"
}

/** Attempts stuck in a non-terminal state longer than this read as abandoned. */
export const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000

/** The status the admin panel shows: stale created/redirected → abandoned. */
export function effectiveStatus(status: string, createdAt: Date | string | null | undefined, now: Date): string {
  if (TERMINAL.has(status)) return status
  const created = createdAt ? new Date(createdAt).getTime() : Number.NaN
  if (Number.isFinite(created) && now.getTime() - created > ABANDONED_AFTER_MS) return "abandoned"
  return status
}

export async function logAttemptCreated(input: {
  orgId: string
  userId: string
  ownerEmail: string
  organizationName: string
  planKey: string
  billingCycle: string | null
  provider: "dodo" | "stub"
}): Promise<string | null> {
  try {
    const [row] = await db
      .insert(billingAttempts)
      .values({
        organizationId: input.orgId,
        userId: input.userId,
        ownerEmail: input.ownerEmail,
        organizationName: input.organizationName,
        planKey: input.planKey,
        billingCycle: input.billingCycle,
        provider: input.provider,
        status: "created",
      })
      .returning({ id: billingAttempts.id })
    return row?.id ?? null
  } catch {
    return null
  }
}

/** Advance an attempt by id (transition-guarded). Non-fatal. */
export async function markAttempt(
  attemptId: string | null | undefined,
  updates: {
    status?: AttemptStatus
    dodoSubscriptionId?: string
    dodoPaymentId?: string
    currency?: string | null
    providerErrorMessage?: string
    webhookErrorDetails?: unknown
  },
): Promise<void> {
  if (!attemptId) return
  try {
    const [row] = await db.select().from(billingAttempts).where(eq(billingAttempts.id, attemptId))
    if (!row) return
    const next: Record<string, unknown> = { updatedAt: new Date() }
    if (updates.status && canTransition(row.status, updates.status)) {
      next.status = updates.status
      if (TERMINAL.has(updates.status)) next.completedAt = new Date()
    }
    if (updates.dodoSubscriptionId) next.dodoSubscriptionId = updates.dodoSubscriptionId
    if (updates.dodoPaymentId) next.dodoPaymentId = updates.dodoPaymentId
    if (updates.currency !== undefined) next.currency = updates.currency
    if (updates.providerErrorMessage !== undefined) next.providerErrorMessage = updates.providerErrorMessage.slice(0, 2000)
    if (updates.webhookErrorDetails !== undefined) next.webhookErrorDetails = updates.webhookErrorDetails
    await db.update(billingAttempts).set(next).where(eq(billingAttempts.id, attemptId))
  } catch {
    /* non-fatal */
  }
}

/**
 * Advance an attempt from a webhook/reconcile event that doesn't know the row
 * id: prefer the attempt_id carried in Dodo metadata, then the newest attempt
 * for the Dodo subscription id, then (reconcile only) the newest attempt for
 * the org. Non-fatal.
 */
export async function markAttemptByRef(
  ref: { attemptId?: string | null; dodoSubscriptionId?: string | null; orgId?: string | null },
  updates: Parameters<typeof markAttempt>[1],
): Promise<void> {
  try {
    let id: string | null = ref.attemptId ?? null
    if (!id && ref.dodoSubscriptionId) {
      const [row] = await db
        .select({ id: billingAttempts.id })
        .from(billingAttempts)
        .where(eq(billingAttempts.dodoSubscriptionId, ref.dodoSubscriptionId))
        .orderBy(desc(billingAttempts.createdAt))
        .limit(1)
      id = row?.id ?? null
    }
    if (!id && ref.orgId) {
      const [row] = await db
        .select({ id: billingAttempts.id })
        .from(billingAttempts)
        .where(eq(billingAttempts.organizationId, ref.orgId))
        .orderBy(desc(billingAttempts.createdAt))
        .limit(1)
      id = row?.id ?? null
    }
    if (id) await markAttempt(id, updates)
  } catch {
    /* non-fatal */
  }
}
