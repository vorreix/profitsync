import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { budgetEnvelopes, budgetEvents, budgetPlans, organizations } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth } from "../../_lib/auth.js"
import { amountExceedsLimit } from "../../../src/lib/money.js"
import { safeTimezone } from "../../../src/lib/schedule-notifications.js"
import {
  isIncomeMode,
  isPlanCadence,
  clampInt,
  isIsoDate,
} from "../../../src/lib/budget-math.js"
import { buildBudgetView, loadPlan } from "../../_lib/budget-engine.js"

// GET    /api/budgets/v2   — the ONE aggregate read (read-only; reports sync_required)
// POST   /api/budgets/v2   — create the plan (the four-decision wizard's single write)
// PATCH  /api/budgets/v2   — plan settings, pause/resume
// DELETE /api/budgets/v2   — archive the plan (history is kept)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role, accountType } = ctx

  // ── READ ──────────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const view = await buildBudgetView(orgId, role, accountType, new Date())
    return res.json(view)
  }

  // ── CREATE ────────────────────────────────────────────────────────────────
  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

    // BUSINESS WORKSPACES GET NO PLAN (spec §23, decision D-1).
    //
    // Not a technical limit — a product decision. Business revenue has no single
    // figure (it is per client, and already modelled by clients, quotations and
    // /analytics), so `expected_income`, `funding_base`, `unallocated` and most
    // of Safe-to-spend have no business meaning. Business keeps its per-client
    // SPEND CAPS, which are a different concept and unaffected.
    //
    // The migration already refuses business orgs (§13.10.7). This is the same
    // rule on the other path into a plan: without it the wizard would happily
    // create a household budget on a business workspace, so the invariant held
    // on one route and not the other.
    if (accountType !== "personal") {
      return res.status(403).json({
        error: "business_not_supported",
        message: "Budgets on a business workspace are per-client spend caps, not a household plan",
      })
    }

    const existing = await loadPlan(orgId)
    if (existing) return res.status(409).json({ error: "A budget plan already exists for this workspace" })

    const body = req.body as {
      cadence?: string
      anchor_day?: number
      week_start_day?: number
      custom_start?: string
      custom_days?: number
      timezone?: string
      income_mode?: string
      expected_income?: number | null
      spending_target?: number | null
      included_account_ids?: string[]
    }

    const cadence = isPlanCadence(body.cadence) ? body.cadence : "monthly"
    const incomeMode = isIncomeMode(body.income_mode) ? body.income_mode : "expected"

    // Expected income is required in `expected` mode — otherwise the mode is a
    // lie. "My income varies" is the explicit alternative (income_mode=available).
    const expectedIncome = body.expected_income == null ? null : Number(body.expected_income)
    if (incomeMode === "expected") {
      if (expectedIncome == null || !Number.isFinite(expectedIncome) || expectedIncome <= 0) {
        return res.status(400).json({ error: "expected_income is required unless income varies" })
      }
      if (amountExceedsLimit(expectedIncome)) return res.status(400).json({ error: "Amount is too large" })
    }

    const target = body.spending_target == null ? null : Number(body.spending_target)
    if (target != null) {
      if (!Number.isFinite(target) || target <= 0) return res.status(400).json({ error: "spending_target must be positive" })
      if (amountExceedsLimit(target)) return res.status(400).json({ error: "Amount is too large" })
    }

    if (cadence === "custom" && body.custom_start != null && !isIsoDate(body.custom_start)) {
      return res.status(400).json({ error: "custom_start must be YYYY-MM-DD" })
    }

    const [org] = await db.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, orgId))

    const [plan] = await db
      .insert(budgetPlans)
      .values({
        organizationId: orgId,
        status: "active",
        cadence,
        anchorDay: cadence === "payday" ? clampInt(body.anchor_day ?? 1, 1, 31) : null,
        weekStartDay: clampInt(body.week_start_day ?? 1, 1, 7),
        customDays: cadence === "custom" ? clampInt(body.custom_days ?? 30, 1, 400) : null,
        customStart: cadence === "custom" ? (body.custom_start ?? null) : null,
        // Validated on WRITE as well as read, so a bad zone can never be stored.
        timezone: safeTimezone(body.timezone),
        incomeMode,
        expectedIncome: incomeMode === "expected" && expectedIncome != null ? String(expectedIncome) : null,
        includedAccountIds: Array.isArray(body.included_account_ids) ? body.included_account_ids : [],
        currency: org?.currency ?? "USD",
        createdBy: userId,
        updatedBy: userId,
      })
      .returning()

    // The beginner's ONE overall envelope. A plan is never envelope-less: with no
    // ceiling, safe-to-spend would silently degrade to cash-only (§8.5).
    if (target != null) {
      await db.insert(budgetEnvelopes).values({
        planId: plan.id,
        organizationId: orgId,
        section: "flexible",
        name: "Everyday spending",
        targetAmount: String(target),
        targetCadence: "period",
        isCatchAll: true,
        carryPolicy: "surplus",
        createdBy: userId,
        updatedBy: userId,
      })
    }

    await db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      action: "plan_created",
      amount: target != null ? String(target) : null,
      detail: { cadence, income_mode: incomeMode, has_target: target != null },
      actorUserId: userId,
    })

    // The wizard's next call is POST /sync, which opens the first period.
    return res.status(201).json({ plan: serialize(plan), sync_required: true })
  }

  // ── SETTINGS / PAUSE / RESUME ─────────────────────────────────────────────
  if (req.method === "PATCH") {
    const plan = await loadPlan(orgId)
    if (!plan) return res.status(404).json({ error: "No budget plan" })

    const body = req.body as {
      status?: string
      cadence?: string
      anchor_day?: number
      week_start_day?: number
      custom_start?: string
      custom_days?: number
      timezone?: string
      income_mode?: string
      expected_income?: number | null
      included_account_ids?: string[]
      next_period_seed?: string
      expected_updated_at?: string
    }

    // Pause/resume is a write; plan-wide SETTINGS are irreversible enough to
    // warrant canDelete (owner/admin), per §18.2.
    const settingsKeys = ["cadence", "anchor_day", "week_start_day", "custom_start", "custom_days", "timezone", "income_mode", "included_account_ids"]
    const touchesSettings = settingsKeys.some((k) => k in (body ?? {}))
    if (touchesSettings || body.status) {
      if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    } else if (!canWrite(role)) {
      return res.status(403).json({ error: "Forbidden" })
    }

    // Optimistic concurrency (§10.10): a stale editor gets a 409 with the truth.
    if (body.expected_updated_at && plan.updatedAt) {
      const seen = new Date(body.expected_updated_at).getTime()
      const actual = new Date(plan.updatedAt).getTime()
      if (Number.isFinite(seen) && seen !== actual) {
        return res.status(409).json({ error: "Someone else changed this plan", plan: serialize(plan) })
      }
    }

    const updates: Record<string, unknown> = { updatedBy: userId, updatedAt: new Date() }

    if (body.status) {
      if (!["active", "paused"].includes(body.status)) {
        return res.status(400).json({ error: "status must be active or paused" })
      }
      updates.status = body.status
      updates.pausedAt = body.status === "paused" ? new Date() : null
    }
    if (body.cadence !== undefined) {
      if (!isPlanCadence(body.cadence)) return res.status(400).json({ error: "Invalid cadence" })
      updates.cadence = body.cadence
      // Changing cadence applies from the NEXT period; the current one keeps its
      // boundaries, which is what makes the lifecycle deterministic (§6.16).
      if (body.cadence !== "payday") updates.anchorDay = null
      if (body.cadence !== "custom") {
        updates.customDays = null
        updates.customStart = null
      }
    }
    if (body.anchor_day !== undefined) updates.anchorDay = clampInt(body.anchor_day, 1, 31)
    if (body.week_start_day !== undefined) updates.weekStartDay = clampInt(body.week_start_day, 1, 7)
    if (body.custom_days !== undefined) updates.customDays = clampInt(body.custom_days, 1, 400)
    if (body.custom_start !== undefined) {
      if (body.custom_start != null && !isIsoDate(body.custom_start)) {
        return res.status(400).json({ error: "custom_start must be YYYY-MM-DD" })
      }
      updates.customStart = body.custom_start
    }
    if (body.timezone !== undefined) updates.timezone = safeTimezone(body.timezone)
    if (body.income_mode !== undefined) {
      if (!isIncomeMode(body.income_mode)) return res.status(400).json({ error: "Invalid income_mode" })
      updates.incomeMode = body.income_mode
      if (body.income_mode === "available") updates.expectedIncome = null
    }
    if (body.expected_income !== undefined) {
      const v = body.expected_income == null ? null : Number(body.expected_income)
      if (v != null && (!Number.isFinite(v) || v < 0 || amountExceedsLimit(v))) {
        return res.status(400).json({ error: "Invalid expected_income" })
      }
      updates.expectedIncome = v == null ? null : String(v)
    }
    if (body.included_account_ids !== undefined) {
      updates.includedAccountIds = Array.isArray(body.included_account_ids) ? body.included_account_ids : []
    }
    if (body.next_period_seed !== undefined) {
      if (!["copy", "fresh", "suggest"].includes(body.next_period_seed)) {
        return res.status(400).json({ error: "Invalid next_period_seed" })
      }
      updates.nextPeriodSeed = body.next_period_seed
    }

    const [updated] = await db.update(budgetPlans).set(updates).where(eq(budgetPlans.id, plan.id)).returning()

    const action = body.status === "paused" ? "plan_paused" : body.status === "active" ? "plan_resumed" : "plan_settings_changed"
    await db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      action,
      detail: Object.fromEntries(Object.entries(body ?? {}).filter(([k]) => k !== "expected_updated_at")),
      actorUserId: userId,
    })

    return res.json({ plan: serialize(updated) })
  }

  // ── ARCHIVE ───────────────────────────────────────────────────────────────
  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    const plan = await loadPlan(orgId)
    if (!plan) return res.status(404).json({ error: "No budget plan" })

    // Archived, never row-deleted: snapshots and events must outlive the plan.
    await db
      .update(budgetPlans)
      .set({ status: "archived", updatedBy: userId, updatedAt: new Date() })
      .where(eq(budgetPlans.id, plan.id))
    await db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      action: "plan_archived",
      detail: { note: "history retained" },
      actorUserId: userId,
    })
    return res.json({ ok: true, archived: true })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
