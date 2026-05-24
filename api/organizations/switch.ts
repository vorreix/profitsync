import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db"
import { organizationMembers, userProfiles } from "../../src/lib/db/schema"
import { getUserId } from "../_lib/auth"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const { organization_id } = req.body as { organization_id?: string }
  if (!organization_id) return res.status(400).json({ error: "organization_id is required" })

  // Confirm membership
  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organization_id),
        eq(organizationMembers.userId, userId),
      ),
    )
  if (!member) return res.status(404).json({ error: "Not a member of this organization" })

  const [updated] = await db
    .update(userProfiles)
    .set({ currentOrganizationId: organization_id, updatedAt: new Date() })
    .where(eq(userProfiles.id, userId))
    .returning()
  return res.json(serialize(updated))
}
