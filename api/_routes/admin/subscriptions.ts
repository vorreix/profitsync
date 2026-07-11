import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, desc, eq, ilike, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { organizations, subscriptions, userProfiles } from "../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../_lib/admin.js"
import { cancelledNowFields, FREE_RESET_FIELDS, stopDodoBilling } from "../../_lib/admin-billing.js"
import { notifySubscriptionChanged } from "../../_lib/notify-billing.js"

const PAGE_SIZE = 30
// free + the current paid tiers (personal/business). "premium" kept for legacy rows.
const VALID_PLANS = ["free", "personal", "business", "premium"]
// "pending" = checkout created, not yet paid (set by create-subscription). It's a
// real status, so it's filterable/settable here alongside the rest.
const VALID_STATUSES = ["pending", "active", "past_due", "cancelled", "trialing"]
const VALID_CYCLES = ["monthly", "yearly", ""] // empty allowed for free

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, req.method === "GET" ? "read" : "write")
  if (!ctx) return

  if (req.method === "GET") {
    const { search, plan, status, page } = req.query as {
      search?: string; plan?: string; status?: string; page?: string
    }
    const pageNum = Math.max(1, parseInt(page ?? "1", 10) || 1)
    const offset = (pageNum - 1) * PAGE_SIZE

    const searchFilter = search?.trim()
      ? ilike(organizations.name, `%${search.trim()}%`)
      : undefined
    const planFilter = plan && VALID_PLANS.includes(plan) ? eq(subscriptions.planKey, plan) : undefined
    const statusFilter =
      status && VALID_STATUSES.includes(status) ? eq(subscriptions.status, status) : undefined

    const whereClause = and(searchFilter, planFilter, statusFilter)

    const [{ total }] = await db
      .select({ total: count() })
      .from(subscriptions)
      .innerJoin(organizations, eq(organizations.id, subscriptions.organizationId))
      .where(whereClause)

    const rows = await db
      .select({
        id: subscriptions.id,
        organizationId: subscriptions.organizationId,
        organizationName: organizations.name,
        ownerEmail: userProfiles.email,
        planKey: subscriptions.planKey,
        status: subscriptions.status,
        billingCycle: subscriptions.billingCycle,
        provider: subscriptions.provider,
        providerSubscriptionId: subscriptions.providerSubscriptionId,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAt: subscriptions.cancelAt,
        cancelledAt: subscriptions.cancelledAt,
        createdAt: subscriptions.createdAt,
        updatedAt: subscriptions.updatedAt,
      })
      .from(subscriptions)
      .innerJoin(organizations, eq(organizations.id, subscriptions.organizationId))
      .leftJoin(userProfiles, eq(userProfiles.id, organizations.ownerUserId))
      .where(whereClause)
      .orderBy(desc(subscriptions.updatedAt))
      .limit(PAGE_SIZE)
      .offset(offset)

    return res.json({ data: rows.map(serialize), total, pageSize: PAGE_SIZE })
  }

  if (req.method === "PATCH") {
    const { subscription_id, plan_key, status, billing_cycle, current_period_end } = req.body as {
      subscription_id?: string
      plan_key?: string
      status?: string
      billing_cycle?: string
      current_period_end?: string | null
    }
    if (!subscription_id) return res.status(400).json({ error: "subscription_id is required" })
    if (plan_key !== undefined && !VALID_PLANS.includes(plan_key)) {
      return res.status(400).json({ error: "Invalid plan_key" })
    }
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid status" })
    }
    if (billing_cycle !== undefined && !VALID_CYCLES.includes(billing_cycle)) {
      return res.status(400).json({ error: "Invalid billing_cycle" })
    }

    const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription_id))
    if (!existing) return res.status(404).json({ error: "Not found" })

    // Downgrading to free / cancelling must also stop billing on Dodo and clear the
    // stale period+cancel fields, so the row doesn't keep a "Renews on …" date and
    // Dodo doesn't keep the subscription active. Fail loud on a Dodo error (DB
    // untouched) rather than silently desyncing the mirror.
    const goingFree = plan_key === "free"
    const goingCancelled = status === "cancelled" && !goingFree
    if (goingFree || goingCancelled) {
      const stop = await stopDodoBilling(existing)
      if (stop.provider === "dodo" && !stop.ok) {
        return res.status(502).json({ error: `Dodo cancel failed: ${stop.error}` })
      }
    }

    const manual = {
      ...(plan_key !== undefined ? { planKey: plan_key } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(billing_cycle !== undefined ? { billingCycle: billing_cycle || null } : {}),
      ...(current_period_end !== undefined
        ? { currentPeriodEnd: current_period_end ? new Date(current_period_end) : null }
        : {}),
    }
    const patch = goingFree
      ? { ...FREE_RESET_FIELDS, updatedAt: new Date() }
      : goingCancelled
        ? { ...manual, ...cancelledNowFields(new Date()), updatedAt: new Date() }
        : { ...manual, updatedAt: new Date() }

    const [updated] = await db
      .update(subscriptions)
      .set(patch)
      .where(eq(subscriptions.id, subscription_id))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    // Org owners/admins learn their plan was changed by a platform admin.
    void notifySubscriptionChanged(updated.organizationId, {
      fromPlan: existing.planKey,
      toPlan: updated.planKey,
      fromStatus: existing.status,
      toStatus: updated.status,
    }).catch(() => {})
    return res.json(serialize(updated))
  }

  if (req.method === "POST") {
    const { organization_id, plan_key, status, billing_cycle } = req.body as {
      organization_id?: string
      plan_key?: string
      status?: string
      billing_cycle?: string
    }
    if (!organization_id) return res.status(400).json({ error: "organization_id is required" })
    const finalPlan = plan_key ?? "free"
    if (!VALID_PLANS.includes(finalPlan)) return res.status(400).json({ error: "Invalid plan" })

    const [created] = await db
      .insert(subscriptions)
      .values({
        organizationId: organization_id,
        planKey: finalPlan,
        status: status && VALID_STATUSES.includes(status) ? status : "active",
        billingCycle: billing_cycle && VALID_CYCLES.includes(billing_cycle) ? billing_cycle : null,
      })
      .returning()
    return res.status(201).json(serialize(created))
  }

  // Sneak in count by plan for filter chips
  void sql

  return res.status(405).json({ error: "Method not allowed" })
}
