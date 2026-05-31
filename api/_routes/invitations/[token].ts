import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClerkClient } from "@clerk/backend"
import { and, eq, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db"
import {
  organizationInvitations,
  organizationMembers,
  organizations,
  userProfiles,
} from "../../../src/lib/db/schema"
import { getUserId } from "../../_lib/auth"

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! })

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { token } = req.query as { token: string }
  if (!token) return res.status(400).json({ error: "token is required" })

  const [invitation] = await db
    .select()
    .from(organizationInvitations)
    .where(eq(organizationInvitations.token, token))
  if (!invitation) return res.status(404).json({ error: "Invitation not found" })
  if (invitation.acceptedAt) return res.status(409).json({ error: "Invitation already accepted" })
  if (invitation.declinedAt) return res.status(409).json({ error: "Invitation declined" })
  if (invitation.expiresAt && invitation.expiresAt < new Date()) {
    return res.status(410).json({ error: "Invitation expired" })
  }

  const [org] = await db
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, invitation.organizationId))

  if (req.method === "GET") {
    return res.json({
      organization: org,
      role: invitation.role,
      email: invitation.email,
      expires_at: invitation.expiresAt,
    })
  }

  if (req.method !== "POST" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Sign in to accept the invitation" })

  // Confirm email matches Clerk's primary email
  const clerkUser = await clerk.users.getUser(userId)
  const userEmail = clerkUser.emailAddresses[0]?.emailAddress?.toLowerCase() ?? ""
  if (userEmail !== invitation.email.toLowerCase()) {
    return res.status(403).json({
      error: `Invitation was sent to ${invitation.email}. Please sign in with that account.`,
    })
  }

  if (req.method === "DELETE") {
    const [declined] = await db
      .update(organizationInvitations)
      .set({ declinedAt: new Date() })
      .where(eq(organizationInvitations.id, invitation.id))
      .returning()
    return res.json(serialize(declined))
  }

  // POST = accept
  const [existing] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, invitation.organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
  if (!existing) {
    await db.insert(organizationMembers).values({
      organizationId: invitation.organizationId,
      userId,
      role: invitation.role,
    })
  }

  // Make sure the accepting user has a profile row (auto-create if not)
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, userId))
  if (!profile) {
    await db.insert(userProfiles).values({
      id: userId,
      email: userEmail,
      fullName: clerkUser.fullName ?? "",
      currentOrganizationId: invitation.organizationId,
    })
  } else if (!profile.currentOrganizationId) {
    await db
      .update(userProfiles)
      .set({ currentOrganizationId: invitation.organizationId, updatedAt: new Date() })
      .where(eq(userProfiles.id, userId))
  }

  void sql // keep the import alive for future enhancements

  const [accepted] = await db
    .update(organizationInvitations)
    .set({ acceptedAt: new Date() })
    .where(eq(organizationInvitations.id, invitation.id))
    .returning()

  return res.json({ invitation: serialize(accepted), organization: org })
}
