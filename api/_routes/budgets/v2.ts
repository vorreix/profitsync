import type { VercelRequest, VercelResponse } from "@vercel/node"
import { randomUUID } from "node:crypto"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { db, dbBatch, serialize } from "../../../src/lib/db/index.js"
import { budgetEnvelopes, budgetEvents, budgetPlans, organizations, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth } from "../../_lib/auth.js"
import { amountExceedsLimit } from "../../../src/lib/money.js"
import { safeTimezone } from "../../../src/lib/schedule-notifications.js"
import {
  isIncomeMode,
  isPlanCadence,
  isViewWindow,
  clampInt,
  isIsoDate,
} from "../../../src/lib/budget-math.js"
import { buildBudgetView, loadPlan, migrationPrompts, planToday } from "../../_lib/budget-engine.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Same cap as envelopes/reorder.ts. */
const MAX_INCLUDED_ACCOUNTS = 200

/**
 * The plan's account scope, validated: an array of THIS org's live bank/cash
 * account ids (an empty array means "all bank + cash", spec table §10.1).
 * Stored verbatim before, one malformed element made every later
 * GET /api/budgets/v2 fail inside the engine's `inArray` (22P02), and an id
 * from another workspace was accepted. Writes a 4xx and returns null on
 * failure.
 */
async function parseIncludedAccountIds(raw: unknown, orgId: string, res: VercelResponse): Promise<string[] | null> {
  if (!Array.isArray(raw)) {
    res.status(400).json({ error: "included_account_ids must be an array of account ids" })
    return null
  }
  if (raw.length > MAX_INCLUDED_ACCOUNTS) {
    res.status(400).json({ error: "Too many account ids" })
    return null
  }
  if (!raw.every((v) => typeof v === "string" && UUID_RE.test(v))) {
    res.status(400).json({ error: "included_account_ids must be account ids" })
    return null
  }
  const ids = [...new Set(raw as string[])]
  if (!ids.length) return []
  const owned = await db
    .select({ id: wealthAccounts.id })
    .from(wealthAccounts)
    .where(
      and(
        eq(wealthAccounts.organizationId, orgId),
        inArray(wealthAccounts.id, ids),
        inArray(wealthAccounts.type, ["bank", "cash"]),
        isNull(wealthAccounts.archivedAt),
      ),
    )
  if (owned.length !== ids.length) {
    res.status(404).json({ error: "account_not_found", message: "One of those accounts is not in this workspace" })
    return null
  }
  return ids
}

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
    // `?window=week|month|year` re-windows the budgets LIST only; anything else
    // (or nothing) reads in the plan's natural window. An unknown value is
    // ignored rather than refused — a stale client must still get its figures.
    const raw = req.query.window
    const window = isViewWindow(raw) ? raw : undefined
    const view = await buildBudgetView(orgId, role, accountType, new Date(), { window })
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
      spending_target?: number
      included_account_ids?: string[]
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return res.status(400).json({ error: "Invalid body" })

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

    // The one spending target is REQUIRED (§6.1): it becomes the catch-all, and
    // without it the plan has no ceiling and can never get one — only the
    // wizard creates the catch-all (envelopes.ts) and it cannot be removed
    // (envelopes/[id].ts). Same invariant as the DELETE guard, on the create path.
    const target = body.spending_target == null ? NaN : Number(body.spending_target)
    if (!Number.isFinite(target) || target <= 0) {
      return res.status(400).json({ error: "spending_target is required and must be positive" })
    }
    if (amountExceedsLimit(target)) return res.status(400).json({ error: "Amount is too large" })

    // A custom cadence needs its anchor (§8.2): without one the period grid has
    // nothing to hang on and periods could not stay contiguous.
    if (cadence === "custom" && !isIsoDate(body.custom_start)) {
      return res.status(400).json({ error: "custom_start is required for a custom cadence (YYYY-MM-DD)" })
    }

    const includedAccountIds = await parseIncludedAccountIds(body.included_account_ids ?? [], orgId, res)
    if (!includedAccountIds) return

    const [org] = await db.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, orgId))

    // ONE round trip: the plan, its catch-all and the audit row land together
    // or not at all — no window in which a plan exists without its ceiling,
    // and a failed audit write blocks the edit (D-6).
    const planId = randomUUID()
    const results = await dbBatch([
      db
        .insert(budgetPlans)
        .values({
          id: planId,
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
          includedAccountIds,
          currency: org?.currency ?? "USD",
          createdBy: userId,
          updatedBy: userId,
        })
        .returning(),
      // The beginner's ONE overall envelope. A plan is never envelope-less: with
      // no ceiling, safe-to-spend would silently degrade to cash-only (§8.5).
      db.insert(budgetEnvelopes).values({
        planId,
        organizationId: orgId,
        section: "flexible",
        // Named for what it IS on the budgets page — the line that catches
        // whatever no other budget claims. The old default duplicated the
        // section's own title and read as a mistake (handoff §4.3).
        name: "Everything else",
        targetAmount: String(target),
        targetCadence: "period",
        isCatchAll: true,
        carryPolicy: "surplus",
        createdBy: userId,
        updatedBy: userId,
      }),
      db.insert(budgetEvents).values({
        organizationId: orgId,
        planId,
        action: "plan_created",
        amount: String(target),
        detail: { cadence, income_mode: incomeMode, has_target: true },
        actorUserId: userId,
      }),
    ] as unknown as Parameters<typeof dbBatch>[0])
    const plan = (results[0] as (typeof budgetPlans.$inferSelect)[])[0]

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

    if (!body || typeof body !== "object" || Array.isArray(body)) return res.status(400).json({ error: "Invalid body" })

    // Pause/resume is a write; plan-wide SETTINGS are irreversible enough to
    // warrant canDelete (owner/admin), per §18.2.
    const settingsKeys = ["cadence", "anchor_day", "week_start_day", "custom_start", "custom_days", "timezone", "income_mode", "included_account_ids"]
    const touchesSettings = settingsKeys.some((k) => k in body)
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
      // A migrated LIFETIME cap is parked as a paused plan whose catch-all
      // carries the cap verbatim (§13.4). Resuming it generically would turn
      // that lifetime figure into a per-period target — exactly the silent
      // re-denomination the migration refuses. The lifetime prompt is the
      // only way out; it records the user's choice and resumes.
      if (body.status === "active" && plan.status === "paused") {
        const prompts = await migrationPrompts(orgId, plan, 0, planToday(plan))
        if (prompts.lifetime_choice) {
          return res.status(409).json({
            error: "lifetime_choice_required",
            message: "This budget was a lifetime cap — choose how to carry it over before resuming",
          })
        }
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
      const ids = await parseIncludedAccountIds(body.included_account_ids, orgId, res)
      if (!ids) return
      updates.includedAccountIds = ids
    }
    if (body.next_period_seed !== undefined) {
      if (!["copy", "fresh", "suggest"].includes(body.next_period_seed)) {
        return res.status(400).json({ error: "Invalid next_period_seed" })
      }
      updates.nextPeriodSeed = body.next_period_seed
    }

    // A custom cadence must END UP with an anchor (§8.2), whichever half of
    // (cadence, custom_start) this request changes.
    const resultingCadence = (updates.cadence as string | undefined) ?? plan.cadence
    const resultingStart = "customStart" in updates ? (updates.customStart as string | null) : plan.customStart
    if (resultingCadence === "custom" && !isIsoDate(resultingStart)) {
      return res.status(400).json({ error: "custom_start is required for a custom cadence (YYYY-MM-DD)" })
    }

    const action = body.status === "paused" ? "plan_paused" : body.status === "active" ? "plan_resumed" : "plan_settings_changed"
    // The audit row records what was APPLIED — the validated, clamped values —
    // not the raw request body, which could carry unknown keys of any size.
    const applied = Object.fromEntries(Object.entries(updates).filter(([k]) => k !== "updatedBy" && k !== "updatedAt"))
    // ONE round trip: the change and its audit row land together (D-6).
    const results = await dbBatch([
      db.update(budgetPlans).set(updates).where(eq(budgetPlans.id, plan.id)).returning(),
      db.insert(budgetEvents).values({
        organizationId: orgId,
        planId: plan.id,
        action,
        detail: serialize(applied),
        actorUserId: userId,
      }),
    ] as unknown as Parameters<typeof dbBatch>[0])
    const updated = (results[0] as (typeof budgetPlans.$inferSelect)[])[0]

    return res.json({ plan: serialize(updated) })
  }

  // ── ARCHIVE ───────────────────────────────────────────────────────────────
  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    const plan = await loadPlan(orgId)
    if (!plan) return res.status(404).json({ error: "No budget plan" })

    // Archived, never row-deleted: snapshots and events must outlive the plan.
    // ONE batch, so a failed audit write blocks the archive (D-6).
    await dbBatch([
      db
        .update(budgetPlans)
        .set({ status: "archived", updatedBy: userId, updatedAt: new Date() })
        .where(eq(budgetPlans.id, plan.id)),
      db.insert(budgetEvents).values({
        organizationId: orgId,
        planId: plan.id,
        action: "plan_archived",
        detail: { note: "history retained" },
        actorUserId: userId,
      }),
    ] as unknown as Parameters<typeof dbBatch>[0])
    return res.json({ ok: true, archived: true })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
