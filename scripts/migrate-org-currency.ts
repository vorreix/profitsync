import { config } from "dotenv"
config({ path: ".env.local" })

import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import { eq } from "drizzle-orm"
import {
  organizations,
  subscriptions,
  userProfiles,
} from "../src/lib/db/schema"

async function main() {
  const sqlClient = neon(process.env.DATABASE_URL!)
  const db = drizzle(sqlClient, { schema: { organizations, subscriptions, userProfiles } })

  // 1. For each org, set currency to owner's profile.currency (if set and not already 'USD')
  const orgs = await db.select().from(organizations)
  for (const org of orgs) {
    const [owner] = await db.select().from(userProfiles).where(eq(userProfiles.id, org.ownerUserId))
    const desired = owner?.currency ?? "USD"
    if (org.currency !== desired) {
      await db
        .update(organizations)
        .set({ currency: desired, updatedAt: new Date() })
        .where(eq(organizations.id, org.id))
      console.log(`  updated org ${org.name} (${org.id}) → ${desired}`)
    }
  }

  // 2. Ensure every org has a subscription (free as default)
  const allSubs = await db.select().from(subscriptions)
  const orgsWithSubs = new Set(allSubs.map((s) => s.organizationId))
  for (const org of orgs) {
    if (!orgsWithSubs.has(org.id)) {
      await db.insert(subscriptions).values({
        organizationId: org.id,
        planKey: "free",
        status: "active",
      })
      console.log(`  bootstrapped free subscription for org ${org.name} (${org.id})`)
    }
  }

  console.log("Migration complete.")
}

main().catch((e) => { console.error(e); process.exit(1) })
