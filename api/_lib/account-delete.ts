import { createClerkClient } from "@clerk/backend"
import { and, eq, or } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import {
  accountDeletionCodes,
  appAdmins,
  legalAcceptances,
  notificationPreferences,
  notificationReminders,
  notifications,
  organizationMembers,
  organizations,
  payoutRequests,
  pushEvents,
  pushSubscriptions,
  referralCodes,
  referrals,
  userProfiles,
} from "../../src/lib/db/schema.js"
import { teardownOrganization, type OrgDeleteResult } from "./admin-org-delete.js"

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! })

export type AccountDeleteResult = { organizations: OrgDeleteResult[]; clerkDeleted: boolean }

/**
 * Fully delete a user account. Shared by the self-serve OTP flow and the admin
 * console. Ordered so billing stops first (teardownOrganization cancels Dodo
 * before deleting each owned org) and the Clerk user goes LAST — /api/profile
 * upserts a profile on first call, so a surviving Clerk login would silently
 * resurrect an empty account. Every step is idempotent: a partial failure is
 * safe to retry end-to-end.
 */
export async function deleteUserAccount(userId: string): Promise<AccountDeleteResult> {
  const owned = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.ownerUserId, userId))
  const orgResults: OrgDeleteResult[] = []
  for (const o of owned) orgResults.push(await teardownOrganization(o.id))

  // Memberships in orgs the user does NOT own (owned-org rows died with the org).
  await db.delete(organizationMembers).where(eq(organizationMembers.userId, userId))

  // User-scoped tables with no FK cascade — delete explicitly so nothing is orphaned.
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
  await db.delete(pushEvents).where(eq(pushEvents.userId, userId))
  await db.delete(legalAcceptances).where(eq(legalAcceptances.userId, userId))
  await db.delete(referralCodes).where(eq(referralCodes.userId, userId))
  await db.delete(referrals).where(or(eq(referrals.referrerUserId, userId), eq(referrals.referredUserId, userId)))
  await db.delete(payoutRequests).where(eq(payoutRequests.userId, userId))
  await db.delete(notifications).where(eq(notifications.userId, userId))
  await db
    .delete(notificationPreferences)
    .where(and(eq(notificationPreferences.scope, "user"), eq(notificationPreferences.userId, userId)))
  await db.delete(notificationReminders).where(eq(notificationReminders.userId, userId))
  await db.delete(accountDeletionCodes).where(eq(accountDeletionCodes.userId, userId))
  await db.delete(appAdmins).where(eq(appAdmins.userId, userId))

  await db.delete(userProfiles).where(eq(userProfiles.id, userId))

  let clerkDeleted = false
  for (let attempt = 0; attempt < 2 && !clerkDeleted; attempt++) {
    try {
      await clerk.users.deleteUser(userId)
      clerkDeleted = true
    } catch (err) {
      // 404 = already gone (e.g. retrying a partially-failed deletion) — done.
      if ((err as { status?: number }).status === 404) clerkDeleted = true
      else if (attempt === 1) console.error("Clerk user deletion failed for", userId, err)
    }
  }
  return { organizations: orgResults, clerkDeleted }
}
