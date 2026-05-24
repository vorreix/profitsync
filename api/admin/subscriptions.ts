import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, desc, eq, ilike, sql } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db"
import { organizations, subscriptions, userProfiles } from "../../src/lib/db/schema"
import { requireAdmin } from "../_lib/admin"

const PAGE_SIZE = 30
const VALID_PLANS = ["free", "premium"]
const VALID_STATUSES = ["active", "past_due", "cancelled", "trialing"]
const VALID_CYCLES = ["monthly", "yearly", ""] // empty allowed for free

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const adminId = await requireAdmin(req, res)
  if (!adminId) return

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

    const [updated] = await db
      .update(subscriptions)
      .set({
        ...(plan_key !== undefined ? { planKey: plan_key } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(billing_cycle !== undefined ? { billingCycle: billing_cycle || null } : {}),
        ...(current_period_end !== undefined
          ? { currentPeriodEnd: current_period_end ? new Date(current_period_end) : null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, subscription_id))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
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
