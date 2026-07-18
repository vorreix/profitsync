import { config } from "dotenv"
config({ path: ".env.local" })

import { createClerkClient } from "@clerk/backend"
import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import { eq, sql } from "drizzle-orm"
import { appAdmins, plans, subscriptions, organizations } from "../src/lib/db/schema"

const SEED_ADMIN_EMAIL = "rootmtt@gmail.com"

async function main() {
  const sqlClient = neon(process.env.DATABASE_URL!)
  const db = drizzle(sqlClient, {
    schema: { appAdmins, plans, subscriptions, organizations },
  })

  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! })

  // 1. Promote admin
  const users = await clerk.users.getUserList({ emailAddress: [SEED_ADMIN_EMAIL] })
  if (users.totalCount === 0) {
    console.warn(`No Clerk user with email ${SEED_ADMIN_EMAIL} found, skipping admin seed.`)
  } else {
    const userId = users.data[0].id
    const [existing] = await db.select().from(appAdmins).where(eq(appAdmins.userId, userId))
    if (existing) {
      console.log(`Admin ${SEED_ADMIN_EMAIL} (${userId}) already exists.`)
    } else {
      await db.insert(appAdmins).values({ userId })
      console.log(`Promoted ${SEED_ADMIN_EMAIL} (${userId}) to admin.`)
    }
  }

  // 2. Seed plans (idempotent upsert by key)
  const defaultLimits = {
    free: {
      clients: 10,
      transactionsPerClient: 30,
      quotations: 30,
      attachmentSizeKb: 1024,
      attachmentsPerTx: 1,
      noteLength: 200,
      tagsPerTransaction: 1,
      aiParsesPerMonth: 20,
    },
    premium: {
      clients: 1000,
      transactionsPerClient: 10000,
      quotations: 10000,
      attachmentSizeKb: 10240,
      attachmentsPerTx: 10,
      noteLength: 100000,
      tagsPerTransaction: 3,
      aiParsesPerMonth: 500,
    },
  }

  const defaultGeoPricing = {
    IN: {
      currency: "INR",
      monthly: 499900, // 4999 INR in paise
      yearly: 4999900, // 49999 INR in paise
      monthlyDiscountPct: 50,
      yearlyDiscountPct: 50,
    },
  }

  const planSeeds = [
    {
      key: "free",
      name: "Free",
      monthlyPriceUsd: "0",
      yearlyPriceUsd: "0",
      monthlyDiscountPct: 0,
      yearlyDiscountPct: 0,
      limits: defaultLimits.free,
      geoPricing: {},
    },
    {
      key: "premium",
      name: "Premium",
      monthlyPriceUsd: "29",
      yearlyPriceUsd: "290",
      monthlyDiscountPct: 0,
      yearlyDiscountPct: 20,
      limits: defaultLimits.premium,
      geoPricing: defaultGeoPricing,
    },
  ]

  for (const p of planSeeds) {
    const [existing] = await db.select().from(plans).where(eq(plans.key, p.key))
    if (existing) {
      console.log(`Plan ${p.key} exists — leaving as-is.`)
    } else {
      await db.insert(plans).values(p)
      console.log(`Seeded plan ${p.key}.`)
    }
  }

  // 3. Ensure every org has a 'free' subscription row
  const orgsWithoutSub = await sqlClient`
    SELECT o.id AS id FROM organizations o
    LEFT JOIN subscriptions s ON s.organization_id = o.id
    WHERE s.id IS NULL
  `
  for (const row of orgsWithoutSub) {
    await db.insert(subscriptions).values({
      organizationId: row.id as string,
      planKey: "free",
      status: "active",
    })
    console.log(`  bootstrapped free subscription for org ${row.id}`)
  }

  console.log("Seed complete.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
