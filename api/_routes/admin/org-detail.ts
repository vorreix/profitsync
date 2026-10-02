import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import {
  clients,
  organizationMembers,
  organizations,
  subscriptions,
  transactions,
  userProfiles,
} from "../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../_lib/admin.js"
import { ensureRatesForOrg, reportingCurrencyFor } from "../../_lib/fx-rates.js"
import { expenseSumSqlIn, fxFor, incomeSumSqlIn, missingRateCountSql, pnlKindFilter, withFx } from "../../_lib/tx-sql.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, "read")
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const { organization_id } = req.query as { organization_id?: string }
  if (!organization_id) return res.status(400).json({ error: "organization_id is required" })

  const [org] = await db.select().from(organizations).where(eq(organizations.id, organization_id))
  if (!org) return res.status(404).json({ error: "Not found" })

  const [owner] = await db
    .select({ id: userProfiles.id, email: userProfiles.email, fullName: userProfiles.fullName })
    .from(userProfiles)
    .where(eq(userProfiles.id, org.ownerUserId))

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organization_id))
    .orderBy(desc(subscriptions.updatedAt))

  const members = await db
    .select({
      id: organizationMembers.id,
      userId: organizationMembers.userId,
      role: organizationMembers.role,
      createdAt: organizationMembers.createdAt,
      email: userProfiles.email,
      fullName: userProfiles.fullName,
    })
    .from(organizationMembers)
    .leftJoin(userProfiles, eq(userProfiles.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, organization_id))
    .orderBy(desc(organizationMembers.createdAt))

  const [counts] = await db
    .select({
      clientCount: sql<number>`(select count(*)::int from clients c where c.organization_id = ${organization_id} and c.deleted_at is null)`,
      // Live, non-system rows: a trashed row or an Opening Balance is not a transaction anyone made.
      transactionCount: sql<number>`(
        select count(*)::int from transactions t
        inner join clients c on c.id = t.client_id
        where c.organization_id = ${organization_id} and c.deleted_at is null and t.deleted_at is null and t.is_system = false
      )`,
      quotationCount: sql<number>`(select count(*)::int from quotations q where q.organization_id = ${organization_id} and q.deleted_at is null)`,
    })
    .from(organizations)
    .where(eq(organizations.id, organization_id))

  // Income and expense the way every workspace report counts them (MC-112):
  // the shared tx-sql rules (transfers nowhere, refunds net against expense,
  // never income), live non-system rows only, each converted at its own date
  // into the workspace's reporting currency. A row with no rate is left out
  // and counted — the totals are labelled with the currency they are in and
  // never pretend to be complete. Net is computed here, in numeric, not by a
  // float subtraction in the browser. Rates once per (currency, day), when the
  // workspace holds a foreign currency (MC-167; tx-sql.ts `fxFor`).
  const reporting = await reportingCurrencyFor(organization_id)
  const orgRates = await ensureRatesForOrg(organization_id, reporting).catch(() => undefined)
  const scope = and(eq(clients.organizationId, organization_id), isNull(clients.deletedAt), isNull(transactions.deletedAt), eq(transactions.isSystem, false), pnlKindFilter)
  const fx = fxFor(reporting, scope, orgRates)
  const [pnl] = await withFx(
    db
      .select({
        income: incomeSumSqlIn(fx),
        expense: expenseSumSqlIn(fx),
        net: sql<string>`round((${incomeSumSqlIn(fx)}) - (${expenseSumSqlIn(fx)}), 2)::text`,
        excluded: missingRateCountSql(fx),
      })
      .from(transactions)
      .innerJoin(clients, eq(clients.id, transactions.clientId))
      .$dynamic(),
    fx,
  ).where(scope)

  return res.json({
    organization: serialize(org),
    owner: owner ? serialize(owner) : null,
    subscription: sub ? serialize(sub) : null,
    members: members.map(serialize),
    counts: counts
      ? {
          ...serialize(counts),
          incoming_total: String(pnl?.income ?? "0"),
          outgoing_total: String(pnl?.expense ?? "0"),
          net_total: String(pnl?.net ?? "0"),
          totals_currency: reporting,
          excluded_count: Number(pnl?.excluded ?? 0),
        }
      : null,
  })
}
