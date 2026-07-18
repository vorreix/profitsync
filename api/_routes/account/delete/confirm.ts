import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db } from "../../../../src/lib/db/index.js"
import { accountDeletionCodes } from "../../../../src/lib/db/schema.js"
import { DELETION_CODE_MAX_ATTEMPTS, verifyDeletionCode } from "../../../../src/lib/account-otp.js"
import { requireAuth } from "../../../_lib/auth.js"
import { deleteUserAccount } from "../../../_lib/account-delete.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  const { userId } = ctx

  const { code } = req.body as { code?: string }
  if (!code || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "Enter the 6-digit code.", code: "invalid_code" })
  }

  const [row] = await db.select().from(accountDeletionCodes).where(eq(accountDeletionCodes.userId, userId))
  if (!row) return res.status(400).json({ error: "Request a code first.", code: "no_code" })

  const verdict = verifyDeletionCode(
    { codeHash: row.codeHash, expiresAt: row.expiresAt, attempts: row.attempts },
    userId,
    code,
    new Date(),
  )
  if (verdict === "expired") return res.status(400).json({ error: "That code expired.", code: "expired" })
  if (verdict === "too_many_attempts") {
    return res.status(429).json({ error: "Too many attempts.", code: "too_many_attempts" })
  }
  if (verdict === "mismatch") {
    await db
      .update(accountDeletionCodes)
      .set({ attempts: row.attempts + 1 })
      .where(eq(accountDeletionCodes.userId, userId))
    return res.status(400).json({
      error: "Wrong code.",
      code: "invalid_code",
      attempts_left: Math.max(0, DELETION_CODE_MAX_ATTEMPTS - row.attempts - 1),
    })
  }

  const result = await deleteUserAccount(userId)
  if (!result.clerkDeleted) {
    // All app data is gone; only the Clerk login survived. Retrying is safe.
    return res.status(500).json({ error: "Deletion incomplete — please retry.", code: "clerk_delete_failed" })
  }
  return res.json({ deleted: true })
}
