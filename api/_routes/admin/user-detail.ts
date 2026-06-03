import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import {
  appAdmins,
  organizationMembers,
  organizations,
  userProfiles,
} from "../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../_lib/admin.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, "read")
  if (!ctx) return
  const adminId = ctx.userId

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const { user_id } = req.query as { user_id?: string }
  if (!user_id) return res.status(400).json({ error: "user_id is required" })

  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, user_id))
  if (!profile) return res.status(404).json({ error: "Not found" })

  const [adminRow] = await db.select().from(appAdmins).where(eq(appAdmins.userId, user_id))

  const orgs = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      isPersonal: organizations.isPersonal,
      role: organizationMembers.role,
      planKey: sql<string>`(select s.plan_key from subscriptions s where s.organization_id = organizations.id order by s.updated_at desc limit 1)`,
      planStatus: sql<string>`(select s.status from subscriptions s where s.organization_id = organizations.id order by s.updated_at desc limit 1)`,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, user_id))
    .orderBy(desc(organizations.createdAt))

  return res.json({
    profile: serialize(profile),
    isAdmin: !!adminRow,
    organizations: orgs.map(serialize),
  })
}
