import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, eq, isNotNull, isNull } from "drizzle-orm"
import { db } from "../../src/lib/db"
import {
  clients,
  invoices,
  organizations,
  subscriptions,
  userProfiles,
} from "../../src/lib/db/schema"
import { requireAdmin } from "../_lib/admin"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireAdmin(req, res)
  if (!userId) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const [
    [{ users }],
    [{ banned }],
    [{ orgs }],
    [{ personalOrgs }],
    [{ subs }],
    [{ paidSubs }],
    [{ paidInvoices }],
    [{ clientsTotal }],
  ] = await Promise.all([
    db.select({ users: count() }).from(userProfiles),
    db.select({ banned: count() }).from(userProfiles).where(isNotNull(userProfiles.bannedAt)),
    db.select({ orgs: count() }).from(organizations),
    db.select({ personalOrgs: count() }).from(organizations).where(eq(organizations.isPersonal, true)),
    db.select({ subs: count() }).from(subscriptions),
    db
      .select({ paidSubs: count() })
      .from(subscriptions)
      .where(and(eq(subscriptions.planKey, "premium"), eq(subscriptions.status, "active"))),
    db.select({ paidInvoices: count() }).from(invoices).where(eq(invoices.status, "paid")),
    db.select({ clientsTotal: count() }).from(clients).where(isNull(clients.deletedAt)),
  ])

  return res.json({
    users,
    bannedUsers: banned,
    activeUsers: users - banned,
    organizations: orgs,
    personalOrganizations: personalOrgs,
    teamOrganizations: orgs - personalOrgs,
    subscriptions: subs,
    paidSubscriptions: paidSubs,
    paidInvoices,
    clientsTotal,
  })
}
