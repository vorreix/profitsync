import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import {
  organizationMembers,
  organizations,
  subscriptions,
  userProfiles,
} from "../../../src/lib/db/schema.js"
import { requireAdmin } from "../../_lib/admin.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const adminId = await requireAdmin(req, res)
  if (!adminId) return
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
      transactionCount: sql<number>`(
        select count(*)::int from transactions t
        inner join clients c on c.id = t.client_id
        where c.organization_id = ${organization_id} and c.deleted_at is null
      )`,
      quotationCount: sql<number>`(select count(*)::int from quotations q where q.organization_id = ${organization_id} and q.deleted_at is null)`,
      incomingTotal: sql<string>`(
        select coalesce(sum(t.amount::numeric), 0)::text from transactions t
        inner join clients c on c.id = t.client_id
        where c.organization_id = ${organization_id} and c.deleted_at is null and t.type = 'incoming'
      )`,
      outgoingTotal: sql<string>`(
        select coalesce(sum(t.amount::numeric), 0)::text from transactions t
        inner join clients c on c.id = t.client_id
        where c.organization_id = ${organization_id} and c.deleted_at is null and t.type = 'outgoing'
      )`,
    })
    .from(organizations)
    .where(eq(organizations.id, organization_id))

  void isNull // imported for parity with other admin handlers

  return res.json({
    organization: serialize(org),
    owner: owner ? serialize(owner) : null,
    subscription: sub ? serialize(sub) : null,
    members: members.map(serialize),
    counts: counts ? serialize(counts) : null,
  })
}
