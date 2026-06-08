import { and, desc, eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { clients, organizations, quotations, subscriptions, userProfiles } from "../../src/lib/db/schema.js"
import { stopDodoBilling, type StopBillingResult } from "./admin-billing.js"

export type OrgDeleteResult = {
  id: string
  deleted: boolean
  dodo: StopBillingResult
}

/**
 * Fully tear down one organization (admin action):
 *
 * 1. **Stop billing on Dodo** for its subscription so the customer is no longer
 *    charged (no-op for free/stub/manual rows).
 * 2. **Reassign** any user whose *active* org is this one back to their personal org
 *    (or null), so they don't land on a deleted workspace.
 * 3. **Delete its clients + quotations** — these tables have NO `organization_id`
 *    foreign key, so deleting the org row alone would orphan them (and their
 *    transactions + attachments). Their own cascades clean those up.
 * 4. **Delete the org row** — its FKs cascade subscriptions, members, categories,
 *    wealth accounts (+ their attachments), audit logs, invoices, and invitations.
 *
 * Never throws on a Dodo error — the local org is still removed and the Dodo outcome
 * is returned for the caller to report (an admin force-delete shouldn't be blocked by
 * a payment-processor hiccup; the failed cancel is surfaced, not swallowed silently).
 */
export async function teardownOrganization(orgId: string): Promise<OrgDeleteResult> {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, orgId))
    .orderBy(desc(subscriptions.updatedAt))
    .limit(1)
  const dodo: StopBillingResult = sub ? await stopDodoBilling(sub) : { provider: "none" }

  const affected = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(eq(userProfiles.currentOrganizationId, orgId))
  for (const p of affected) {
    const [personal] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.ownerUserId, p.id), eq(organizations.isPersonal, true)))
    // Don't point them at this org (it's being deleted); null is fine if no other.
    const nextOrg = personal && personal.id !== orgId ? personal.id : null
    await db
      .update(userProfiles)
      .set({ currentOrganizationId: nextOrg, updatedAt: new Date() })
      .where(eq(userProfiles.id, p.id))
  }

  // Tables that lack an org FK cascade — delete explicitly so nothing is orphaned.
  await db.delete(clients).where(eq(clients.organizationId, orgId))
  await db.delete(quotations).where(eq(quotations.organizationId, orgId))

  const res = await db
    .delete(organizations)
    .where(eq(organizations.id, orgId))
    .returning({ id: organizations.id })
  return { id: orgId, deleted: res.length > 0, dodo }
}
