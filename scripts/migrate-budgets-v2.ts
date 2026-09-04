#!/usr/bin/env -S npx tsx
/**
 * Migrate v1 budgets to Budget v2 plans (spec §13).
 *
 *   npx tsx --env-file=.env.local scripts/migrate-budgets-v2.ts --dry-run        # report, write nothing
 *   npx tsx --env-file=.env.local scripts/migrate-budgets-v2.ts                  # apply
 *   npx tsx --env-file=.env.local scripts/migrate-budgets-v2.ts --org <uuid>     # one org (staged rollout)
 *   npx tsx --env-file=.env.local scripts/migrate-budgets-v2.ts --limit 50       # a batch at a time
 *
 * DATABASE_URL comes from `.env.local` (the Neon instance) — `--env-file` loads it
 * before `src/lib/db` constructs its client at import time. An already-exported
 * DATABASE_URL wins over the file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GOVERNING PRINCIPLE (§13.1): do not silently reinterpret user data.
 *
 * Every v1 budget carries a meaning its owner chose. This script either
 * preserves that meaning exactly, or leaves it visibly untouched and asks. It
 * is ADDITIVE ONLY — it never mutates or deletes a `budgets` or
 * `budget_history` row, which is what makes rollback "stop reading the new
 * tables" with no restore step (§13.9).
 *
 * What it must NEVER do (§13.10), each enforced below:
 *   1. Convert a `lifetime` budget to a periodic one          → paused plan
 *   2. Infer `expected_income` from any figure                → income_mode='available'
 *   3. Create a plan for a user with no v1 budget             → skipped entirely
 *   4. Fabricate historical snapshots                         → current period only
 *   5. Convert, relabel or re-denominate any amount           → currency copied, amount verbatim
 *   6. Mutate or delete a v1 row                              → no UPDATE/DELETE anywhere
 *   7. Turn a business client cap into a household envelope   → business orgs skipped
 *
 * Idempotent and resumable: an org that already has a plan is skipped, so a
 * failed run is re-runnable and a partial batch can simply be repeated.
 */
import { and, eq, isNull, sql } from "drizzle-orm"
import { db } from "../src/lib/db/index.js"
import {
  budgetEnvelopes,
  budgetEvents,
  budgetHistory,
  budgetPlans,
  budgets,
  organizations,
} from "../src/lib/db/schema.js"
import { openPeriod, planToday } from "../api/_lib/budget-engine.js"
import { periodFor, type PlanCadence, type TargetCadence } from "../src/lib/budget-math.js"

// ── arguments ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const DRY_RUN = argv.includes("--dry-run")
const VERBOSE = argv.includes("--verbose")
const argValue = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const ONLY_ORG = argValue("--org")
const LIMIT = Number(argValue("--limit") ?? "0") || 0

/**
 * v1 period → v2 cadence + envelope target cadence (§13.2).
 *
 * `daily` is the interesting one: v1's "€20 a day" is preserved as a MONTHLY
 * plan whose envelope is authored per-day, so the intent survives and the
 * engine normalises it to the period. Converting it to a daily *plan* would
 * create a new period every day, which is not what the user asked for.
 *
 * `lifetime` is deliberately absent — it has no periodic equivalent and is
 * handled by pausing the plan (§13.4).
 */
const CADENCE_MAP: Record<string, { cadence: PlanCadence; targetCadence: TargetCadence }> = {
  monthly: { cadence: "monthly", targetCadence: "period" },
  weekly: { cadence: "weekly", targetCadence: "period" },
  daily: { cadence: "monthly", targetCadence: "day" },
}

/** v1 history action → v2 event action (§13.2), mapped 1:1. */
const ACTION_MAP: Record<string, string> = {
  set: "amount_changed",
  raise: "amount_changed",
  lower: "amount_changed",
  period_change: "cadence_changed",
  remove: "envelope_removed",
}

type Report = {
  scanned: number
  migrated: number
  paused: number
  skippedNoBudget: number
  skippedBusiness: number
  skippedExisting: number
  historyCopied: number
  problems: { orgId: string; reason: string }[]
}

const report: Report = {
  scanned: 0,
  migrated: 0,
  paused: 0,
  skippedNoBudget: 0,
  skippedBusiness: 0,
  skippedExisting: 0,
  historyCopied: 0,
  problems: [],
}

const log = (...a: unknown[]) => console.log(...a)
const vlog = (...a: unknown[]) => VERBOSE && console.log(...a)

async function migrateOrg(org: { id: string; name: string; accountType: string | null; currency: string }) {
  report.scanned++
  const label = `${org.id.slice(0, 8)} "${org.name}"`

  // ── §13.10.7 — a business client cap is NOT a household envelope ──────────
  // Business orgs keep their per-client caps in the v1 tables, unchanged and
  // still served by the v1 handler. Nothing to create, nothing to touch.
  if (org.accountType !== "personal") {
    report.skippedBusiness++
    vlog(`  skip ${label}: business workspace — client caps stay in v1 (§23)`)
    return
  }

  // ── §13.10.3 — never create a plan for someone who had no budget ─────────
  const [v1] = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.organizationId, org.id), isNull(budgets.clientId)))
  if (!v1) {
    report.skippedNoBudget++
    vlog(`  skip ${label}: no org-level v1 budget (§13.7)`)
    return
  }

  // ── idempotency: an org that already has a plan is done ──────────────────
  const [existing] = await db
    .select({ id: budgetPlans.id })
    .from(budgetPlans)
    .where(and(eq(budgetPlans.organizationId, org.id), sql`${budgetPlans.status} <> 'archived'`))
  if (existing) {
    report.skippedExisting++
    vlog(`  skip ${label}: already has plan ${existing.id.slice(0, 8)}`)
    return
  }

  const amount = Number(v1.amount)
  const v1Period = String(v1.period)
  const mapped = CADENCE_MAP[v1Period]

  // ── §13.4 — a lifetime budget is migrated PAUSED, never converted ────────
  // "Total ever spent against a cap" has no v2 period. Turning a 10,000
  // lifetime cap into a 10,000 MONTHLY budget would be a serious
  // misrepresentation, so nothing is tracked until the user chooses.
  const isLifetime = v1Period === "lifetime"
  if (!mapped && !isLifetime) {
    report.problems.push({ orgId: org.id, reason: `unknown v1 period "${v1Period}"` })
    log(`  PROBLEM ${label}: unknown v1 period "${v1Period}" — left untouched`)
    return
  }

  const cadence = mapped?.cadence ?? "monthly"
  const targetCadence = mapped?.targetCadence ?? "period"

  if (DRY_RUN) {
    log(
      `  WOULD ${isLifetime ? "PAUSE" : "MIGRATE"} ${label}: ` +
        `v1 ${v1Period} ${amount} ${org.currency} → cadence=${cadence} target_cadence=${targetCadence}`,
    )
    const hist = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(budgetHistory)
      .where(and(eq(budgetHistory.organizationId, org.id), isNull(budgetHistory.clientId)))
    log(`         + ${hist[0]?.n ?? 0} history row(s) → budget_events`)
    if (isLifetime) report.paused++
    else report.migrated++
    return
  }

  // ── create the plan ──────────────────────────────────────────────────────
  const [plan] = await db
    .insert(budgetPlans)
    .values({
      organizationId: org.id,
      // §13.4: a lifetime budget tracks NOTHING until the user picks a target.
      status: isLifetime ? "paused" : "active",
      pausedAt: isLifetime ? new Date() : null,
      cadence,
      weekStartDay: 1,
      // UTC EXACTLY preserves v1 semantics: v1 had no timezone and computed its
      // windows in UTC, so any other zone would shift which transactions fall
      // in a period and silently change the numbers the user already saw.
      timezone: "UTC",
      // §13.10.2: v1 had no income concept, so claiming `expected` would invent
      // data. `available` is the honest mode — capacity comes from real money.
      incomeMode: "available",
      expectedIncome: null,
      includedAccountIds: [],
      // §13.10.5: copied, never converted or re-denominated.
      currency: org.currency,
      createdBy: v1.createdBy ?? null,
      updatedBy: v1.updatedBy ?? null,
    })
    .returning()

  // ── the catch-all envelope, carrying the v1 amount VERBATIM ──────────────
  await db.insert(budgetEnvelopes).values({
    planId: plan.id,
    organizationId: org.id,
    section: "flexible",
    name: "Everyday spending",
    // The authored amount is the v1 amount unchanged; the engine normalises it
    // to the period from `targetCadence`, so a "20/day" intent stays 20/day.
    targetAmount: String(amount),
    targetCadence,
    matchKeys: [],
    isCatchAll: true,
    carryPolicy: "surplus",
    priority: "important",
    createdBy: v1.createdBy ?? null,
    updatedBy: v1.updatedBy ?? null,
  })

  // ── open the CURRENT period only (§13.10.4 — no fabricated history) ──────
  // A paused plan opens no period, exactly as sync would refuse to.
  if (!isLifetime) {
    const today = planToday(plan)
    const window = periodFor(
      {
        cadence: plan.cadence as PlanCadence,
        weekStartDay: plan.weekStartDay,
        anchorDay: plan.anchorDay,
        customStart: plan.customStart,
        customDays: plan.customDays,
      },
      today,
    )
    await openPeriod(org.id, plan, window, {
      isPartial: today !== window.start,
      actorUserId: null,
      // §13.3: snapshot, NEVER reconstruct. Reconstructing to a boundary before
      // the plan existed would describe a period v2 never governed, and could
      // count income already inside the migrated balance twice.
      forceSource: "snapshot_at_open",
    })
  }

  // ── copy v1 history → budget_events, preserving time and actor ───────────
  const history = await db
    .select()
    .from(budgetHistory)
    .where(and(eq(budgetHistory.organizationId, org.id), isNull(budgetHistory.clientId)))
    .orderBy(budgetHistory.createdAt)

  if (history.length) {
    await db.insert(budgetEvents).values(
      history.map((h) => ({
        organizationId: org.id,
        planId: plan.id,
        periodId: null,
        // No envelopeId: the v1 row predates envelopes, and pointing it at the
        // new catch-all would assert a link that did not exist.
        action: ACTION_MAP[h.action] ?? h.action,
        amount: h.amount,
        detail: {
          migrated_from: "v1",
          v1_action: h.action,
          v1_period: h.period,
        },
        actorUserId: h.changedBy ?? null,
        // Preserved, so the trail keeps its real chronology.
        createdAt: h.createdAt ?? new Date(),
      })),
    )
    report.historyCopied += history.length
  }

  // ── one plan_created event marking the provenance ────────────────────────
  await db.insert(budgetEvents).values({
    organizationId: org.id,
    planId: plan.id,
    action: "plan_created",
    amount: String(amount),
    detail: {
      migrated_from: "v1",
      v1_budget_id: v1.id,
      v1_period: v1Period,
      cadence,
      target_cadence: targetCadence,
      // The banner in §13.4 keys off this.
      lifetime_needs_choice: isLifetime,
    },
    actorUserId: null,
  })

  if (isLifetime) {
    report.paused++
    log(`  PAUSED  ${label}: lifetime ${amount} — awaiting the user's choice (§13.4)`)
  } else {
    report.migrated++
    log(`  MIGRATED ${label}: ${v1Period} ${amount} → ${cadence}/${targetCadence}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set")
    process.exit(1)
  }
  const host = new URL(process.env.DATABASE_URL).host
  log(`\nBudget v1 → v2 migration`)
  log(`  target : ${host}`)
  log(`  mode   : ${DRY_RUN ? "DRY RUN (writes nothing)" : "APPLY"}`)
  if (ONLY_ORG) log(`  org    : ${ONLY_ORG}`)
  if (LIMIT) log(`  limit  : ${LIMIT}`)
  log("")

  // Only orgs that actually HAVE an org-level v1 budget are candidates, so the
  // largest cohort (no budget at all) costs nothing to skip (§13.7).
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      accountType: organizations.accountType,
      currency: organizations.currency,
    })
    .from(organizations)
    .where(ONLY_ORG ? eq(organizations.id, ONLY_ORG) : sql`true`)
    .orderBy(organizations.createdAt)

  const batch = LIMIT ? rows.slice(0, LIMIT) : rows
  for (const org of batch) {
    try {
      await migrateOrg(org)
    } catch (err) {
      // One bad org must not abort the run: the script is resumable, so the
      // rest of the batch still gets migrated and the failure is reported.
      const reason = err instanceof Error ? err.message : String(err)
      report.problems.push({ orgId: org.id, reason })
      log(`  ERROR ${org.id.slice(0, 8)}: ${reason}`)
    }
  }

  log(`\n${"─".repeat(60)}`)
  log(`scanned                : ${report.scanned}`)
  log(`migrated               : ${report.migrated}`)
  log(`paused (lifetime)      : ${report.paused}`)
  log(`skipped · no budget    : ${report.skippedNoBudget}`)
  log(`skipped · business     : ${report.skippedBusiness}`)
  log(`skipped · has plan     : ${report.skippedExisting}`)
  log(`history rows copied    : ${report.historyCopied}`)
  if (report.problems.length) {
    log(`problems               : ${report.problems.length}`)
    for (const p of report.problems) log(`  ${p.orgId.slice(0, 8)}: ${p.reason}`)
  }
  log(`${"─".repeat(60)}`)
  if (DRY_RUN) log(`\nDRY RUN — nothing was written. Re-run without --dry-run to apply.\n`)

  process.exit(report.problems.length ? 1 : 0)
}

await main()
