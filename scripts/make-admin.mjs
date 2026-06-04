// Promote (or demote) a user to platform admin.
//
// A platform admin is simply a row in the `app_admins` table (Clerk user id).
//
// Usage (defaults to .env.local):
//   node scripts/make-admin.mjs person@example.com
//   node scripts/make-admin.mjs person@example.com --role=editor   # super_admin|editor|viewer|blog_writer
//   node scripts/make-admin.mjs user_2abc...            # pass a Clerk id directly
//   node scripts/make-admin.mjs person@example.com --remove
//
// Against PRODUCTION (prod DB is separate from local/dev):
//   vercel env pull .env.production.local --environment=production
//   ENV_FILE=.env.production.local node scripts/make-admin.mjs person@example.com
import { config } from "dotenv"
config({ path: process.env.ENV_FILE || ".env.local" })
import { neon } from "@neondatabase/serverless"

const args = process.argv.slice(2)
const remove = args.includes("--remove")
const target = args.find((a) => !a.startsWith("--"))

if (!target) {
  console.error("Usage: node scripts/make-admin.mjs <email|user_xxx> [--remove]")
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (point ENV_FILE at the right env file).")
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL)

// Resolve the Clerk user id.
let userId
if (target.startsWith("user_")) {
  userId = target
} else {
  // Prefer user_profiles (no Clerk call needed); fall back to the Clerk API.
  const [profile] = await sql`select id from user_profiles where lower(email) = lower(${target})`
  if (profile) {
    userId = profile.id
  } else if (process.env.CLERK_SECRET_KEY) {
    const { createClerkClient } = await import("@clerk/backend")
    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
    const users = await clerk.users.getUserList({ emailAddress: [target] })
    if (!users.data.length) {
      console.error(`No Clerk user found for ${target}. Have they signed in at least once?`)
      process.exit(1)
    }
    userId = users.data[0].id
  } else {
    console.error(`No user_profiles row for ${target} and no CLERK_SECRET_KEY to look it up. Pass the user_… id directly.`)
    process.exit(1)
  }
}

if (remove) {
  const deleted = await sql`delete from app_admins where user_id = ${userId} returning user_id`
  console.log(deleted.length ? `✓ removed admin: ${target} (${userId})` : `– ${target} (${userId}) was not an admin`)
} else {
  // Optional role: --role=<super_admin|editor|viewer|blog_writer> (default super_admin).
  const VALID_ROLES = ["super_admin", "editor", "viewer", "blog_writer"]
  const roleArg = args.find((a) => a.startsWith("--role"))
  const role = roleArg ? roleArg.split("=")[1] : "super_admin"
  if (!VALID_ROLES.includes(role)) {
    console.error(`Invalid --role "${role}". Use one of: ${VALID_ROLES.join(", ")}`)
    process.exit(1)
  }
  await sql`insert into app_admins (user_id, role) values (${userId}, ${role})
            on conflict (user_id) do update set role = ${role}`
  console.log(`✓ ${target} (${userId}) is now a platform admin (${role})`)
}
