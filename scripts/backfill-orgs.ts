import { config } from "dotenv"
config({ path: ".env.local" })

import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import { eq, sql, isNull } from "drizzle-orm"
import {
  organizations,
  organizationMembers,
  clients,
  quotations,
  userProfiles,
} from "../src/lib/db/schema"

async function main() {
  const sqlClient = neon(process.env.DATABASE_URL!)
  const db = drizzle(sqlClient, {
    schema: { organizations, organizationMembers, clients, quotations, userProfiles },
  })

  // Collect every distinct user_id that owns data
  const clientUsers = await db
    .selectDistinct({ userId: clients.userId })
    .from(clients)
  const quotationUsers = await db
    .selectDistinct({ userId: quotations.userId })
    .from(quotations)
  const profileUsers = await db.selectDistinct({ userId: userProfiles.id }).from(userProfiles)

  const distinctUsers = new Set<string>([
    ...clientUsers.map((r) => r.userId),
    ...quotationUsers.map((r) => r.userId),
    ...profileUsers.map((r) => r.userId),
  ])

  console.log(`Found ${distinctUsers.size} distinct users to backfill.`)

  for (const userId of distinctUsers) {
    // Find or create personal org
    const [existingPersonal] = await db
      .select()
      .from(organizations)
      .where(sql`${organizations.ownerUserId} = ${userId} AND ${organizations.isPersonal} = true`)

    let personalOrgId: string
    if (existingPersonal) {
      personalOrgId = existingPersonal.id
      console.log(`  ${userId}: found existing personal org ${personalOrgId}`)
    } else {
      const [created] = await db
        .insert(organizations)
        .values({
          ownerUserId: userId,
          name: "Personal",
          slug: "personal",
          isPersonal: true,
        })
        .returning()
      personalOrgId = created.id
      console.log(`  ${userId}: created personal org ${personalOrgId}`)

      await db.insert(organizationMembers).values({
        organizationId: personalOrgId,
        userId,
        role: "owner",
      })
    }

    // Backfill clients
    const updatedClients = await db
      .update(clients)
      .set({ organizationId: personalOrgId })
      .where(sql`${clients.userId} = ${userId} AND ${clients.organizationId} IS NULL`)
      .returning({ id: clients.id })
    console.log(`    backfilled ${updatedClients.length} clients`)

    // Backfill quotations
    const updatedQuotations = await db
      .update(quotations)
      .set({ organizationId: personalOrgId })
      .where(sql`${quotations.userId} = ${userId} AND ${quotations.organizationId} IS NULL`)
      .returning({ id: quotations.id })
    console.log(`    backfilled ${updatedQuotations.length} quotations`)

    // Set current_organization_id on profile if missing
    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.id, userId))
    if (profile && !profile.currentOrganizationId) {
      await db
        .update(userProfiles)
        .set({ currentOrganizationId: personalOrgId })
        .where(eq(userProfiles.id, userId))
      console.log(`    set current_organization_id on profile`)
    }
  }

  console.log("Backfill complete.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
