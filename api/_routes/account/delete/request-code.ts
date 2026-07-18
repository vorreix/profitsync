import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClerkClient } from "@clerk/backend"
import { eq } from "drizzle-orm"
import { db } from "../../../../src/lib/db/index.js"
import { accountDeletionCodes, userProfiles } from "../../../../src/lib/db/schema.js"
import {
  DELETION_CODE_TTL_MS,
  generateDeletionCode,
  hashDeletionCode,
  maskEmail,
  resendWaitSeconds,
} from "../../../../src/lib/account-otp.js"
import { requireAuth } from "../../../_lib/auth.js"
import { isEmailConfigured, sendAccountDeletionCodeEmail } from "../../../_lib/email.js"

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! })

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  const { userId } = ctx

  if (!isEmailConfigured()) {
    return res.status(503).json({ error: "Account deletion is unavailable right now.", code: "email_unavailable" })
  }

  const [existing] = await db.select().from(accountDeletionCodes).where(eq(accountDeletionCodes.userId, userId))
  if (existing) {
    const wait = resendWaitSeconds(existing.lastSentAt, new Date())
    if (wait > 0) {
      return res
        .status(429)
        .json({ error: "Please wait before requesting another code.", code: "cooldown", retry_after: wait })
    }
  }

  // Prefer the live Clerk primary email; fall back to the profile snapshot.
  let email: string | null = null
  try {
    const user = await clerk.users.getUser(userId)
    email =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ??
      user.emailAddresses[0]?.emailAddress ??
      null
  } catch {
    /* fall through to the profile email */
  }
  if (!email) {
    const [profile] = await db
      .select({ email: userProfiles.email })
      .from(userProfiles)
      .where(eq(userProfiles.id, userId))
    email = profile?.email ?? null
  }
  if (!email) return res.status(400).json({ error: "No email address on file.", code: "no_email" })

  const code = generateDeletionCode()
  const now = new Date()
  const values = {
    codeHash: hashDeletionCode(userId, code),
    expiresAt: new Date(now.getTime() + DELETION_CODE_TTL_MS),
    attempts: 0,
    lastSentAt: now,
  }
  await db
    .insert(accountDeletionCodes)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: accountDeletionCodes.userId, set: values })

  const sent = await sendAccountDeletionCodeEmail({ to: email, code })
  if (!sent.ok) {
    return res.status(502).json({ error: "Couldn't send the confirmation code.", code: "email_send_failed" })
  }
  return res.json({ sent: true, email: maskEmail(email), expires_in: Math.floor(DELETION_CODE_TTL_MS / 1000) })
}
