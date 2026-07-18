// Pure helpers for the delete-account email-OTP flow. Server-side logic, but it
// lives in src/lib so the DB-free unit gate can cover it. The frontend never
// imports this module (node:crypto).
import { createHash, randomInt, timingSafeEqual } from "node:crypto"

export const DELETION_CODE_TTL_MS = 10 * 60 * 1000
export const DELETION_CODE_MAX_ATTEMPTS = 5
export const DELETION_CODE_RESEND_COOLDOWN_MS = 60 * 1000

export function generateDeletionCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0")
}

/** Hash bound to the user id, so a leaked hash can't confirm another account. */
export function hashDeletionCode(userId: string, code: string): string {
  return createHash("sha256").update(`${userId}:${code}`).digest("hex")
}

export type DeletionCodeRow = { codeHash: string; expiresAt: Date; attempts: number }
export type DeletionCodeVerdict = "valid" | "expired" | "too_many_attempts" | "mismatch"

export function verifyDeletionCode(
  row: DeletionCodeRow,
  userId: string,
  code: string,
  now: Date,
): DeletionCodeVerdict {
  if (row.attempts >= DELETION_CODE_MAX_ATTEMPTS) return "too_many_attempts"
  if (now.getTime() > row.expiresAt.getTime()) return "expired"
  const expected = Buffer.from(row.codeHash, "hex")
  const provided = createHash("sha256").update(`${userId}:${code}`).digest()
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return "mismatch"
  return "valid"
}

/** Seconds until another code may be sent (0 = allowed now). */
export function resendWaitSeconds(lastSentAt: Date, now: Date): number {
  const elapsed = now.getTime() - lastSentAt.getTime()
  if (elapsed >= DELETION_CODE_RESEND_COOLDOWN_MS) return 0
  return Math.ceil((DELETION_CODE_RESEND_COOLDOWN_MS - elapsed) / 1000)
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@")
  if (at <= 0) return email
  return `${email.slice(0, Math.min(2, at))}•••${email.slice(at)}`
}
