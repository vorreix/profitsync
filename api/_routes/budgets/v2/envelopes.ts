import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, desc, eq, max, ne } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import {
  budgetAllocations,
  budgetEnvelopes,
  budgetEvents,
  budgetPeriods,
} from "../../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../../_lib/auth.js"
import { amountExceedsLimit } from "../../../../src/lib/money.js"
import {
  categoryConflicts,
  isBudgetSection,
  isCarryPolicy,
  isFundingMode,
  isPriority,
  isTargetCadence,
  normalizeMatchKeys,
  normalizeTarget,
  periodDays,
  round2,
  type BudgetSection,
} from "../../../../src/lib/budget-math.js"
import { loadPlan } from "../../../_lib/budget-engine.js"

// GET  /api/budgets/v2/envelopes — the envelope list (for pickers and reorder)
// POST /api/budgets/v2/envelopes — add a category, commitment group, fund or debt
//
// Adding an envelope is the main act of progressive disclosure (§6.4): a plan
// starts as one catch-all and grows a category at a time, never by filling in a
// form of everything up front.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  const plan = await loadPlan(orgId)
  if (!plan) return res.status(404).json({ error: "No budget plan" })

  if (req.method === "GET") {
    const rows = await db
      .select()
      .from(budgetEnvelopes)
      .where(and(eq(budgetEnvelopes.planId, plan.id), ne(budgetEnvelopes.status, "removed")))
      .orderBy(asc(budgetEnvelopes.position), asc(budgetEnvelopes.createdAt))
    return res.json({ envelopes: rows.map(serialize) })
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

  const body = req.body as {
    section?: string
    name?: string
    target_amount?: number
    target_cadence?: string
    match_keys?: string[]
    carry_policy?: string
    carry_cap?: number | null
    priority?: string
    reimbursable?: boolean
    funding_mode?: string
    wealth_account_id?: string | null
    goal_amount?: number | null
    target_date?: string | null
    auto_fund?: boolean
    icon?: string
  }

  const section: BudgetSection = isBudgetSection(body.section) ? body.section : "flexible"
  const name = String(body.name ?? "").trim()
  if (!name) return res.status(400).json({ error: "name is required" })
  if (name.length > 80) return res.status(400).json({ error: "name is too long" })

  const target = Number(body.target_amount ?? 0)
  if (!Number.isFinite(target) || target < 0) return res.status(400).json({ error: "target_amount must be zero or more" })
  if (amountExceedsLimit(target)) return res.status(400).json({ error: "Amount is too large" })

  // ── one category, one envelope (§8.3) ─────────────────────────────────────
  // Enforced BEFORE the insert and reported with the names of the envelopes
  // that already claim the categories, because "invalid" gives the user nothing
  // to act on. Only flexible and income envelopes match categories at all.
  const matchKeys = section === "flexible" || section === "income" ? normalizeMatchKeys(body.match_keys ?? []) : []

  // A SPENDING CATEGORY MUST CLAIM AT LEAST ONE TRANSACTION CATEGORY.
  //
  // Without one it matches nothing and tracks nothing: it would sit on the plan
  // showing a target and a permanent zero, and its spend would silently fall
  // through to the catch-all instead. That is worse than refusing to create it.
  //
  // The catch-all is the deliberate exception — it claims everything no other
  // envelope has claimed, so an explicit list would make it both the general and
  // the specific case at once.
  if (section === "flexible" && !matchKeys.length) {
    return res.status(400).json({
      error: "categories_required",
      message: "Choose at least one category, otherwise this would not track anything",
    })
  }

  if (matchKeys.length) {
    const others = await db
      .select({ id: budgetEnvelopes.id, name: budgetEnvelopes.name, matchKeys: budgetEnvelopes.matchKeys })
      .from(budgetEnvelopes)
      .where(and(eq(budgetEnvelopes.planId, plan.id), ne(budgetEnvelopes.status, "removed")))
    const conflicts = categoryConflicts(
      matchKeys,
      others.map((o) => ({ id: o.id, name: o.name, matchKeys: (o.matchKeys as string[] | null) ?? [] })),
    )
    if (conflicts.length) {
      return res.status(409).json({
        error: "category_claimed",
        message: `Already tracked by ${conflicts.map((c) => c.envelopeName).join(", ")}`,
        conflicts,
      })
    }
  }

  const fundingMode = section === "savings" && isFundingMode(body.funding_mode) ? body.funding_mode : null
  if (fundingMode === "space_backed" && !body.wealth_account_id) {
    return res.status(400).json({ error: "A Space-backed fund needs a Space" })
  }

  const [{ maxPos } = { maxPos: 0 }] = await db
    .select({ maxPos: max(budgetEnvelopes.position) })
    .from(budgetEnvelopes)
    .where(eq(budgetEnvelopes.planId, plan.id))

  let envelope
  try {
    ;[envelope] = await db
      .insert(budgetEnvelopes)
      .values({
        planId: plan.id,
        organizationId: orgId,
        section,
        name,
        targetAmount: String(round2(target)),
        targetCadence: isTargetCadence(body.target_cadence) ? body.target_cadence : "period",
        matchKeys,
        isCatchAll: false, // only the wizard creates the catch-all
        icon: typeof body.icon === "string" ? body.icon.slice(0, 40) : "",
        fundingMode,
        wealthAccountId: fundingMode === "space_backed" ? (body.wealth_account_id ?? null) : null,
        autoFund: section === "savings" ? Boolean(body.auto_fund) : false,
        goalAmount: body.goal_amount == null ? null : String(round2(Number(body.goal_amount))),
        targetDate: body.target_date ?? null,
        carryPolicy: isCarryPolicy(body.carry_policy) ? body.carry_policy : "none",
        carryCap: body.carry_cap == null ? null : String(round2(Number(body.carry_cap))),
        priority: isPriority(body.priority) ? body.priority : "important",
        reimbursable: Boolean(body.reimbursable),
        position: Number(maxPos ?? 0) + 1,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning()
  } catch (err) {
    // budget_envelopes_plan_name_unique is case-insensitive, so "groceries" and
    // "Groceries" collide. Say which rule was hit rather than leaking the
    // constraint name.
    if (violates(err, "budget_envelopes_plan_name_unique")) {
      return res.status(409).json({ error: "name_taken", message: `You already have an envelope called ${name}` })
    }
    throw err
  }

  // Give the new envelope an allocation in the OPEN period immediately, so it
  // appears with its planned amount instead of at zero until the next sync.
  const [open] = await db
    .select()
    .from(budgetPeriods)
    .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "open")))
    .orderBy(desc(budgetPeriods.start))
    .limit(1)

  if (open) {
    const days = periodDays({ start: open.start, endExclusive: open.endExclusive })
    const planned = normalizeTarget(round2(target), envelope.targetCadence as "period" | "month" | "week" | "day", days)
    await db
      .insert(budgetAllocations)
      .values({
        periodId: open.id,
        envelopeId: envelope.id,
        organizationId: orgId,
        plannedAmount: String(planned),
        authoredAmount: String(round2(target)),
        authoredCadence: envelope.targetCadence,
        rolloverIn: "0",
        contributionStatus: envelope.section === "savings" ? "planned" : null,
      })
      .onConflictDoNothing()
  }

  await db.insert(budgetEvents).values({
    organizationId: orgId,
    planId: plan.id,
    periodId: open?.id ?? null,
    envelopeId: envelope.id,
    action: "envelope_created",
    amount: String(round2(target)),
    detail: { section, name, match_keys: matchKeys, funding_mode: fundingMode },
    actorUserId: userId,
  })

  return res.status(201).json({ envelope: serialize(envelope) })
}

/**
 * Did this error violate the named constraint?
 *
 * A NeonDbError puts the constraint in `.constraint` and the offending row in
 * `.detail`; the `.message` is often just "duplicate key value violates unique
 * constraint" with the name quoted, and for a UNIQUE INDEX (as opposed to a
 * table constraint) `.constraint` can be absent entirely. Checking all three is
 * what makes the difference between a helpful 409 and a bare 500.
 */
function violates(err: unknown, constraint: string): boolean {
  // Drizzle wraps the driver error in a DrizzleQueryError whose `message` is the
  // SQL text, so the constraint name lives on `.cause` (the NeonDbError). Walk
  // the chain rather than inspecting only the outer error, which is what made
  // every unique violation surface as a 500 instead of a helpful 409.
  let node: unknown = err
  for (let depth = 0; node && typeof node === "object" && depth < 5; depth++) {
    const e = node as { constraint?: unknown; detail?: unknown; message?: unknown; cause?: unknown }
    if (typeof e.constraint === "string" && e.constraint === constraint) return true
    if ([e.message, e.detail].some((v) => typeof v === "string" && v.includes(constraint))) return true
    node = e.cause
  }
  return false
}
