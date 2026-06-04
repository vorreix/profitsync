import type { VercelRequest, VercelResponse } from "@vercel/node"
import { randomBytes } from "crypto"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import {
  organizationInvitations,
  organizationMembers,
  organizations,
  userProfiles,
} from "../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../_lib/admin.js"

const VALID_ROLES = ["admin", "editor", "viewer"]

function generateToken(): string {
  return randomBytes(24).toString("base64url")
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, req.method === "GET" ? "read" : "write")
  if (!ctx) return
  const adminId = ctx.userId

  if (req.method === "GET") {
    const { organization_id } = req.query as { organization_id?: string }
    if (!organization_id) return res.status(400).json({ error: "organization_id is required" })

    const rows = await db
      .select()
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.organizationId, organization_id),
          isNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.declinedAt),
        ),
      )
      .orderBy(desc(organizationInvitations.createdAt))

    return res.json({ data: rows.map(serialize) })
  }

  if (req.method === "POST") {
    const { organization_id, email, role } = req.body as {
      organization_id?: string
      email?: string
      role?: string
    }
    if (!organization_id || !email?.trim()) {
      return res.status(400).json({ error: "organization_id and email are required" })
    }
    const normalizedRole = role ?? "editor"
    if (!VALID_ROLES.includes(normalizedRole)) {
      return res.status(400).json({ error: "Role must be admin, editor, or viewer" })
    }

    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organization_id))
    if (!org) return res.status(404).json({ error: "Organization not found" })

    const normalizedEmail = email.trim().toLowerCase()

    const [existingMember] = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .innerJoin(userProfiles, eq(userProfiles.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.organizationId, organization_id),
          sql`lower(${userProfiles.email}) = ${normalizedEmail}`,
        ),
      )
    if (existingMember) {
      return res.status(409).json({ error: "User is already a member of this organization" })
    }

    const [existingInvite] = await db
      .select()
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.organizationId, organization_id),
          sql`lower(${organizationInvitations.email}) = ${normalizedEmail}`,
          isNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.declinedAt),
        ),
      )

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 14)

    if (existingInvite) {
      const [updated] = await db
        .update(organizationInvitations)
        .set({ role: normalizedRole, expiresAt })
        .where(eq(organizationInvitations.id, existingInvite.id))
        .returning()
      return res.json(serialize(updated))
    }

    const [created] = await db
      .insert(organizationInvitations)
      .values({
        organizationId: organization_id,
        email: normalizedEmail,
        role: normalizedRole,
        token: generateToken(),
        invitedByUserId: adminId,
        expiresAt,
      })
      .returning()
    return res.status(201).json(serialize(created))
  }

  if (req.method === "DELETE") {
    const { invitation_id } = req.body as { invitation_id?: string }
    if (!invitation_id) return res.status(400).json({ error: "invitation_id is required" })

    const result = await db
      .delete(organizationInvitations)
      .where(eq(organizationInvitations.id, invitation_id))
      .returning({ id: organizationInvitations.id })
    if (!result.length) return res.status(404).json({ error: "Not found" })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
