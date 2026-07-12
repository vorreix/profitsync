import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClerkClient } from "@clerk/backend"
import { and, eq, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import {
  organizationInvitations,
  organizationMembers,
  organizations,
  userProfiles,
} from "../../../src/lib/db/schema.js"
import { getUserId } from "../../_lib/auth.js"
import { createNotification, notifyOrgMembers } from "../../_lib/notifications.js"

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
  const joined = !existing
  if (joined) {
    await db.insert(organizationMembers).values({
      organizationId: invitation.organizationId,
      userId,
      role: invitation.role,
    })
  }

  // Switch the accepting user into the joined org so they land on its dashboard,
  // and stamp onboarded_at so a brand-new invitee (who has no personal-account
  // onboarding yet) isn't bounced to /onboarding before they ever see the
  // workspace they just joined.
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, userId))
  const now = new Date()
  if (!profile) {
    await db.insert(userProfiles).values({
      id: userId,
      email: userEmail,
      fullName: clerkUser.fullName ?? "",
      currentOrganizationId: invitation.organizationId,
      onboardedAt: now,
    })
  } else {
    await db
      .update(userProfiles)
      .set({
        currentOrganizationId: invitation.organizationId,
        onboardedAt: profile.onboardedAt ?? now,
        updatedAt: now,
      })
      .where(eq(userProfiles.id, userId))
  }

  void sql // keep the import alive for future enhancements

  const [accepted] = await db
    .update(organizationInvitations)
    .set({ acceptedAt: new Date() })
    .where(eq(organizationInvitations.id, invitation.id))
    .returning()

  // Notify the inviter that their invitation was accepted (best-effort).
  const accepterName = clerkUser.fullName || userEmail
  void createNotification({
    userId: invitation.invitedByUserId,
    organizationId: invitation.organizationId,
    type: "invitation_accepted",
    title: "Invitation accepted",
    body: `${accepterName} joined ${org?.name ?? "your organization"}`,
    data: {
      i18nKey: "types.invitation_accepted.title",
      i18nBodyKey: "types.invitation_accepted.body",
      i18nParams: { name: accepterName, org: org?.name ?? "" },
    },
    link: `/organizations/${invitation.organizationId}/members`,
    actorUserId: userId,
    dedupeKey: `inv_accepted:${invitation.id}`,
  }).catch(() => {})

  // Tell the rest of the org's owners/admins a new colleague actually joined
  // (only on a real join, not a re-accepted link; the inviter got the personal
  // notification above and the joiner obviously knows).
  if (joined) {
    void notifyOrgMembers(
      invitation.organizationId,
      {
        type: "invitation_accepted",
        title: "Invitation accepted",
        body: `${accepterName} joined ${org?.name ?? "your organization"}`,
        data: {
          i18nKey: "types.invitation_accepted.title",
          i18nBodyKey: "types.invitation_accepted.body",
          i18nParams: { name: accepterName, org: org?.name ?? "" },
        },
        link: `/organizations/${invitation.organizationId}/members`,
        actorUserId: userId,
        dedupeKey: `inv_joined:${invitation.id}`,
      },
      { roles: ["owner", "admin"], excludeUserId: [invitation.invitedByUserId, userId] },
    ).catch(() => {})
  }

  return res.json({ invitation: serialize(accepted), organization: org })
}
