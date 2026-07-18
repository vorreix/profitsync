# Delete Account (email OTP) + Clear Trash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-serve account deletion behind a confirmation + emailed 6-digit OTP on `/profile?tab=account`, and a "Clear trash" purge-all button on `/trash`.

**Architecture:** Two independent branches off `dev`. Trash: one new POST route reusing the purge invariants + a header button/AlertDialog. Delete-account: an `account_deletion_codes` table (hash-only), three routes (summary / request-code / confirm), a shared `deleteUserAccount()` helper built on the existing `teardownOrganization()` (Dodo cancellation), Clerk user deletion last, and a two-step Dialog. The buggy admin user-delete is refactored onto the same helper.

**Tech Stack:** Vercel serverless (consolidated router), Drizzle/Neon, Clerk `@clerk/backend`, Resend HTTP email, React 19 + shadcn (`input-otp` already vendored), i18next (8 locales).

**Spec:** `docs/superpowers/specs/2026-07-18-delete-account-and-trash-purge-design.md`

**Deliberate deviations from the plan-writing rules (flagged):**
- API route handlers get no committed unit tests — the unit gate is DB-FREE by project rule. TDD applies to the pure OTP lib only. Behavior is verified in a real browser + local DB.
- Non-English translations are produced at implementation time via `scripts/i18n-merge.mjs` and enforced by `npm run i18n:check` (which fails the commit if any locale misses a key). The exact EN keys are fully specified below.
- The pre-commit hook runs the FULL gate on every commit (secret scan → esm → boot → i18n → lint → typecheck → test:ci), and i18n:check fails if `en.json` has keys the other locales lack — so each branch lands as one or two complete commits, not micro-commits.

---

## Part 1 — Clear Trash (branch `feat/trash-clear-maqbool`)

### Task 1: Branch + purge-all API route

**Files:**
- Create: `api/_routes/trash/clear.ts`

- [ ] **Step 1: Create the branch off dev**

```bash
git checkout dev && git checkout -b feat/trash-clear-maqbool
```

- [ ] **Step 2: Write `api/_routes/trash/clear.ts`**

Mirrors the invariants in `api/_routes/trash/purge.ts` (read it first), but set-based:

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { clients, quotations, transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, requireAuth } from "../../_lib/auth.js"
import { reversalsByAccount } from "../../../src/lib/wealth-ledger.js"

// Empty the org's whole trash in one shot. Same invariants as single-item purge
// (api/_routes/trash/purge.ts): a soft-deleted transaction's balance was already
// reversed at soft-delete time (never touch it again); a trashed client's LIVE
// transactions were never reversed (reverse them before the cascade delete).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

  // 1. Trashed clients — reverse balances for their LIVE transactions, then
  //    hard-delete (transactions + attachments cascade via FK).
  const trashedClients = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.organizationId, orgId), isNotNull(clients.deletedAt)))
  const clientIds = trashedClients.map((c) => c.id)
  if (clientIds.length) {
    const liveTx = await db
      .select({ wealthAccountId: transactions.wealthAccountId, type: transactions.type, amount: transactions.amount })
      .from(transactions)
      .where(and(inArray(transactions.clientId, clientIds), isNull(transactions.deletedAt)))
    for (const [accountId, shift] of reversalsByAccount(liveTx)) {
      await db
        .update(wealthAccounts)
        .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${shift}`, updatedAt: new Date() })
        .where(eq(wealthAccounts.id, accountId))
    }
    await db.delete(clients).where(inArray(clients.id, clientIds))
  }

  // 2. Remaining trashed transactions (their client is live — client-trashed ones
  //    died with the cascade above). Purging ALL soft-deleted rows inherently
  //    takes every soft-deleted split-group leg, so no orphaned legs.
  const trashedTx = await db
    .select({ id: transactions.id })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(and(eq(clients.organizationId, orgId), isNull(clients.deletedAt), isNotNull(transactions.deletedAt)))
  if (trashedTx.length) {
    await db.delete(transactions).where(inArray(transactions.id, trashedTx.map((t) => t.id)))
  }

  // 3. Trashed quotations (attachments + pdfs cascade via FK).
  const purgedQuotations = await db
    .delete(quotations)
    .where(and(eq(quotations.organizationId, orgId), isNotNull(quotations.deletedAt)))
    .returning({ id: quotations.id })

  return res.json({
    purged: { clients: clientIds.length, transactions: trashedTx.length, quotations: purgedQuotations.length },
  })
}
```

- [ ] **Step 3: Register the route** in `api/index.ts`. Add the import next to the other trash imports (line ~82):

```ts
import trashClear from "./_routes/trash/clear.js"
```

and the route entry directly after `{ segments: ["trash", "purge"], handler: trashPurge },` (line ~232):

```ts
  { segments: ["trash", "clear"], handler: trashClear },
```

(All three segments-2 trash routes are static — no ordering hazard.)

- [ ] **Step 4: Typecheck** — Run: `npm run typecheck`. Expected: exit 0.

### Task 2: Clear-trash UI + EN i18n

**Files:**
- Modify: `src/pages/TrashPage.tsx` (header lines 199–205, state line 44, add handler after `handlePurge`, add dialog after the purge AlertDialog)
- Modify: `src/lib/i18n/locales/en.json` (trash block, after `"expense": "Expense"` line ~1213)

- [ ] **Step 1: Add state + handler.** After `const [purgeTarget, setPurgeTarget] = useState<PurgeTarget | null>(null)` add:

```tsx
  const [clearOpen, setClearOpen] = useState(false)
```

After the `handlePurge` function add:

```tsx
  async function handleClearAll() {
    setWorking(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost("/api/trash/clear", token, {})
      toast.success(t("trashCleared"))
      setClearOpen(false)
      loadData()
    } catch {
      toast.error(t("clearFailed"))
    } finally {
      setWorking(false)
    }
  }
```

- [ ] **Step 2: Header button.** Replace the header `<div>` (lines 200–205) with (flex-wrap so the page body never scrolls horizontally — mobile rule):

```tsx
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{t("title")}</h1>
          {!loading && (
            <p className="text-sm text-muted-foreground mt-1">{t("itemsInTrash", { count: totalCount })}</p>
          )}
        </div>
        {!loading && totalCount > 0 && (
          <Button
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={working}
            onClick={() => setClearOpen(true)}
          >
            <Trash2 className="size-4 mr-1.5" />
            {t("clearTrash")}
          </Button>
        )}
      </div>
```

(`totalCount` is declared at line 194 — it is already computed before the JSX. Keep the declaration above the `return`.)

- [ ] **Step 3: Confirmation dialog.** After the existing purge `</AlertDialog>` (line 268) add a second, state-driven, always-mounted AlertDialog (back-close comes free from the shadcn root):

```tsx
      <AlertDialog open={clearOpen} onOpenChange={(open) => { if (!open) setClearOpen(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("clearTrashTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("clearTrashDesc", { count: totalCount })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearAll}
              disabled={working}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {working ? t("clearing") : t("clearTrash")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

- [ ] **Step 4: EN keys.** In `en.json`'s `"trash"` block, after `"expense": "Expense"` add:

```json
    "clearTrash": "Clear trash",
    "clearTrashTitle": "Clear trash?",
    "clearTrashDesc_one": "{{count}} item will be permanently deleted. This cannot be undone.",
    "clearTrashDesc_other": "All {{count}} items will be permanently deleted. This cannot be undone.",
    "clearing": "Clearing…",
    "trashCleared": "Trash cleared",
    "clearFailed": "Failed to clear trash"
```

- [ ] **Step 5: Translate to the 7 other locales** (`it`, `de`, `hi`, `ml`, `ta`, `te`, `ar`) via `scripts/i18n-merge.mjs`: write `$CLAUDE_JOB_DIR/tmp/i18n-trash.json` shaped `{ "<lang>": { "trash.clearTrash": "…", … } }` with faithful translations for all 7 keys × 7 languages, then run `node scripts/i18n-merge.mjs $CLAUDE_JOB_DIR/tmp/i18n-trash.json`.

- [ ] **Step 6: Verify i18n completeness** — Run: `npm run i18n:check`. Expected: exit 0, no missing keys.

### Task 3: Verify, sync native, commit, push (trash branch)

- [ ] **Step 1: Browser verification** (see the *Verification environment* appendix): trash some records, open `/trash` → button appears with count; confirm dialog → records gone, toast, count 0, button hidden. Check a trashed-client-with-live-transactions case reverses wealth balances (compare `/wealth` before/after). Verify `viewer`/`editor` roles get 403 (server) — UI: button still renders but the API errors; acceptable, matches the existing per-row purge which is also server-gated.
- [ ] **Step 2: Native parity** — Run: `npm run cap:sync:android && npm run cap:sync:ios`. Expected: both end with "Sync finished".
- [ ] **Step 3: Commit (full gate runs)**

```bash
git add api/_routes/trash/clear.ts api/index.ts src/pages/TrashPage.tsx src/lib/i18n/locales/
git commit -m "feat(trash): Clear-trash button — purge every trashed record after one confirmation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push** — `git push -u origin feat/trash-clear-maqbool`. Report the PR compare URL (do NOT push dev).

---

## Part 2 — Delete Account (branch `feat/account-delete-maqbool`, spec already committed there)

### Task 4: Schema + migration 0053

**Files:**
- Modify: `src/lib/db/schema.ts` (insert after the `userProfiles` table closes, line ~477)
- Generated: `drizzle/0053_*.sql`, `drizzle/meta/*`

- [ ] **Step 1:** `git checkout feat/account-delete-maqbool`
- [ ] **Step 2: Add the table** after `userProfiles`:

```ts
// ── Account deletion codes ────────────────────────────────────────────────────
// One pending email-OTP per user for the self-serve delete-account flow. Only
// the SHA-256 hash of the code is stored (hashed with the userId so a leaked
// row can't confirm another account). Upserted on every (re)send; removed by
// deleteUserAccount's cleanup.
export const accountDeletionCodes = pgTable("account_deletion_codes", {
  userId: text("user_id").primaryKey(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastSentAt: timestamp("last_sent_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
})
```

- [ ] **Step 3:** Run `npm run db:generate`. Expected: a new `drizzle/0053_*.sql` containing `CREATE TABLE "account_deletion_codes"`.
- [ ] **Step 4: Journal gotcha.** Open `drizzle/meta/_journal.json`; the new entry's `when` MUST be greater than `1783877744001` (0052's). If not, bump it.
- [ ] **Step 5: Migrate the local/dev DB and verify the table exists:**

```bash
node -r dotenv/config scripts/db-migrate.mjs dotenv_config_path=.env.local
node -r dotenv/config --input-type=module -e "import('@neondatabase/serverless').then(async ({neon}) => { const sql = neon(process.env.DATABASE_URL); console.log(await sql\`select column_name from information_schema.columns where table_name='account_deletion_codes'\`) })" dotenv_config_path=.env.local
```

Expected: 6 columns listed. If it prints `[]`, the migration silently skipped — re-check Step 4.

### Task 5: Pure OTP lib (TDD)

**Files:**
- Create: `src/lib/account-otp.ts`
- Test: `src/lib/account-otp.test.ts`

- [ ] **Step 1: Write the failing test first** (`src/lib/account-otp.test.ts`):

```ts
import { describe, expect, it } from "vitest"
import {
  DELETION_CODE_MAX_ATTEMPTS,
  DELETION_CODE_TTL_MS,
  generateDeletionCode,
  hashDeletionCode,
  maskEmail,
  resendWaitSeconds,
  verifyDeletionCode,
} from "./account-otp"

const now = new Date("2026-07-18T12:00:00Z")
const row = (over: Partial<{ codeHash: string; expiresAt: Date; attempts: number }> = {}) => ({
  codeHash: hashDeletionCode("user_1", "123456"),
  expiresAt: new Date(now.getTime() + DELETION_CODE_TTL_MS),
  attempts: 0,
  ...over,
})

describe("generateDeletionCode", () => {
  it("is always 6 digits (zero-padded)", () => {
    for (let i = 0; i < 200; i++) expect(generateDeletionCode()).toMatch(/^\d{6}$/)
  })
})

describe("hashDeletionCode", () => {
  it("is deterministic and bound to the user id", () => {
    expect(hashDeletionCode("user_1", "123456")).toBe(hashDeletionCode("user_1", "123456"))
    expect(hashDeletionCode("user_1", "123456")).not.toBe(hashDeletionCode("user_2", "123456"))
    expect(hashDeletionCode("user_1", "123456")).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("verifyDeletionCode", () => {
  it("accepts the right code", () => {
    expect(verifyDeletionCode(row(), "user_1", "123456", now)).toBe("valid")
  })
  it("rejects a wrong code", () => {
    expect(verifyDeletionCode(row(), "user_1", "654321", now)).toBe("mismatch")
  })
  it("rejects the right code for the wrong user", () => {
    expect(verifyDeletionCode(row(), "user_2", "123456", now)).toBe("mismatch")
  })
  it("rejects an expired code", () => {
    expect(verifyDeletionCode(row({ expiresAt: new Date(now.getTime() - 1) }), "user_1", "123456", now)).toBe("expired")
  })
  it("locks after max attempts (even with the right code)", () => {
    expect(verifyDeletionCode(row({ attempts: DELETION_CODE_MAX_ATTEMPTS }), "user_1", "123456", now)).toBe(
      "too_many_attempts",
    )
  })
})

describe("resendWaitSeconds", () => {
  it("is 0 after the cooldown and counts down inside it", () => {
    expect(resendWaitSeconds(new Date(now.getTime() - 60_000), now)).toBe(0)
    expect(resendWaitSeconds(new Date(now.getTime() - 45_000), now)).toBe(15)
    expect(resendWaitSeconds(now, now)).toBe(60)
  })
})

describe("maskEmail", () => {
  it("keeps a short prefix and the domain", () => {
    expect(maskEmail("john.doe@gmail.com")).toBe("jo•••@gmail.com")
    expect(maskEmail("a@b.co")).toBe("a•••@b.co")
    expect(maskEmail("not-an-email")).toBe("not-an-email")
  })
})
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run src/lib/account-otp.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `src/lib/account-otp.ts`:**

```ts
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
```

- [ ] **Step 4: Run tests, verify they pass** — `npx vitest run src/lib/account-otp.test.ts`. Expected: all PASS.

### Task 6: Deletion-code email

**Files:**
- Modify: `api/_lib/email.ts` (append after `sendInvitationEmail`)

- [ ] **Step 1: Append:**

```ts
/**
 * Delete-account confirmation code. Unlike invitations this is NOT best-effort:
 * the caller blocks the deletion flow when the send fails (the OTP is the
 * security gate, there is no "copy the link" fallback).
 */
export async function sendAccountDeletionCodeEmail(opts: { to: string; code: string }): Promise<SendResult> {
  const code = escapeHtml(opts.code)
  const subject = `${opts.code} is your ProfitSync account deletion code`
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:14px;border:1px solid #e4e4e7;overflow:hidden;">
          <tr><td style="padding:28px 32px 8px;">
            <div style="font-size:18px;font-weight:700;color:#0a0a0a;">ProfitSync</div>
          </td></tr>
          <tr><td style="padding:8px 32px 0;">
            <h1 style="margin:0 0 8px;font-size:20px;line-height:1.3;color:#0a0a0a;">Confirm your account deletion</h1>
            <p style="margin:0;font-size:14px;line-height:1.6;color:#52525b;">
              You asked to permanently delete your ProfitSync account. Enter this code to confirm:
            </p>
          </td></tr>
          <tr><td style="padding:20px 32px 8px;" align="center">
            <div style="display:inline-block;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:10px;padding:14px 28px;font-size:28px;font-weight:700;letter-spacing:8px;color:#0a0a0a;">${code}</div>
          </td></tr>
          <tr><td style="padding:8px 32px 0;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#a1a1aa;">This code expires in 10 minutes. Deleting your account removes all your organizations and data permanently and cancels any active subscription.</p>
          </td></tr>
          <tr><td style="padding:24px 32px 28px;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#a1a1aa;border-top:1px solid #e4e4e7;padding-top:16px;">
              If you didn't request this, you can safely ignore this email — nothing will happen without the code.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
  const text = `You asked to permanently delete your ProfitSync account.

Your confirmation code: ${opts.code}

This code expires in 10 minutes. Deleting your account removes all your organizations and data permanently and cancels any active subscription.

If you didn't request this, you can safely ignore this email — nothing will happen without the code.`
  return sendEmail({ to: opts.to, subject, html, text })
}
```

### Task 7: `deleteUserAccount()` shared helper

**Files:**
- Create: `api/_lib/account-delete.ts`

- [ ] **Step 1: Write it** (note: `teardownOrganization` already cancels Dodo billing FIRST and repoints other users' `current_organization_id` to their personal org):

```ts
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
```

### Task 8: The three account routes

**Files:**
- Create: `api/_routes/account/delete/summary.ts`
- Create: `api/_routes/account/delete/request-code.ts`
- Create: `api/_routes/account/delete/confirm.ts`
- Modify: `api/index.ts`

(Import depth from `api/_routes/account/delete/`: `../../../_lib/…` and `../../../../src/lib/…`.)

- [ ] **Step 1: `summary.ts`**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { count, eq, inArray } from "drizzle-orm"
import { db } from "../../../../src/lib/db/index.js"
import { organizationMembers, organizations, subscriptions } from "../../../../src/lib/db/schema.js"
import { requireAuth } from "../../../_lib/auth.js"

// What deleting this account will destroy — drives the consequences step of the
// delete-account dialog. DB-only (no Clerk round-trip).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
  const { userId } = ctx

  const owned = await db
    .select({ id: organizations.id, name: organizations.name, isPersonal: organizations.isPersonal })
    .from(organizations)
    .where(eq(organizations.ownerUserId, userId))
  const ownedIds = owned.map((o) => o.id)

  const memberCounts = ownedIds.length
    ? await db
        .select({ orgId: organizationMembers.organizationId, n: count() })
        .from(organizationMembers)
        .where(inArray(organizationMembers.organizationId, ownedIds))
        .groupBy(organizationMembers.organizationId)
    : []
  const countByOrg = new Map(memberCounts.map((m) => [m.orgId, Number(m.n)]))

  const subs = ownedIds.length
    ? await db
        .select({ orgId: subscriptions.organizationId, planKey: subscriptions.planKey, status: subscriptions.status })
        .from(subscriptions)
        .where(inArray(subscriptions.organizationId, ownedIds))
    : []
  const premiumOrgs = new Set(subs.filter((s) => s.planKey !== "free" && s.status !== "cancelled").map((s) => s.orgId))

  const memberships = await db
    .select({ orgId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
  const ownedSet = new Set(ownedIds)
  const otherMemberships = memberships.filter((m) => !ownedSet.has(m.orgId)).length

  return res.json({
    organizations: owned.map((o) => ({
      id: o.id,
      name: o.name,
      is_personal: o.isPersonal,
      member_count: countByOrg.get(o.id) ?? 0,
      has_active_premium: premiumOrgs.has(o.id),
    })),
    other_memberships: otherMemberships,
  })
}
```

- [ ] **Step 2: `request-code.ts`**

```ts
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
      return res.status(429).json({ error: "Please wait before requesting another code.", code: "cooldown", retry_after: wait })
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
    const [profile] = await db.select({ email: userProfiles.email }).from(userProfiles).where(eq(userProfiles.id, userId))
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
```

- [ ] **Step 3: `confirm.ts`**

```ts
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
```

- [ ] **Step 4: Register in `api/index.ts`** — imports next to `profile` (line ~15):

```ts
import accountDeleteSummary from "./_routes/account/delete/summary.js"
import accountDeleteRequestCode from "./_routes/account/delete/request-code.js"
import accountDeleteConfirm from "./_routes/account/delete/confirm.js"
```

and route entries directly after `{ segments: ["profile"], handler: profile },`:

```ts
  { segments: ["account", "delete", "summary"], handler: accountDeleteSummary },
  { segments: ["account", "delete", "request-code"], handler: accountDeleteRequestCode },
  { segments: ["account", "delete", "confirm"], handler: accountDeleteConfirm },
```

- [ ] **Step 5: Typecheck** — `npm run typecheck`. Expected: exit 0.

### Task 9: Refactor admin user-delete onto the helper (bug fix)

**Files:**
- Modify: `api/_routes/admin/users.ts` (DELETE branch, lines 247–280)

- [ ] **Step 1:** Replace everything from the `// Delete every org the user owns…` comment (line 247) through `return res.status(204).end()` (line 280) with:

```ts
    const [existingProfile] = await db
      .select({ id: userProfiles.id })
      .from(userProfiles)
      .where(eq(userProfiles.id, user_id))
    if (!existingProfile) return res.status(404).json({ error: "Not found" })

    // Shared with the self-serve delete-account flow. Fixes two old bugs: owned
    // orgs are now torn down via teardownOrganization (Dodo billing cancelled
    // FIRST — the old direct org delete kept charging the customer), and
    // user-scoped rows (push subscriptions, referral codes, …) are cleaned up.
    // Also deletes the Clerk user so they can't log back in and resurrect an
    // empty account.
    const result = await deleteUserAccount(user_id)
    return res.json({ ok: true, clerk_deleted: result.clerkDeleted })
```

Add the import: `import { deleteUserAccount } from "../../_lib/account-delete.js"`.

- [ ] **Step 2:** Check the admin UI caller tolerates 200-json instead of 204: `grep -rn "admin/users" src/pages/admin/ | grep -i delete`. The client `request()` helper only branches on `res.ok`/204, so 200-json is compatible — confirm the caller doesn't read the response body expecting undefined.
- [ ] **Step 3: Typecheck** — `npm run typecheck`. Expected: exit 0 (drops now-unused imports if flagged by lint — run `npm run lint` and remove any).

### Task 10: DeleteAccountDialog component

**Files:**
- Create: `src/components/DeleteAccountDialog.tsx`

- [ ] **Step 1: Write the component:**

```tsx
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth, useClerk } from "@clerk/clerk-react"
import { apiGet, apiPost, setActiveOrgId } from "@/lib/api"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { AlertTriangle, Building2, Loader as Loader2, MailCheck, Users } from "lucide-react"

type DeleteSummary = {
  organizations: { id: string; name: string; is_personal: boolean; member_count: number; has_active_premium: boolean }[]
  other_memberships: number
}

/** The API client throws the raw response body — pull out our machine-readable fields. */
function apiErrorPayload(err: unknown): { code?: string; retry_after?: number; attempts_left?: number } {
  if (err instanceof Error && err.message.trim().startsWith("{")) {
    try {
      return JSON.parse(err.message) as { code?: string; retry_after?: number; attempts_left?: number }
    } catch {
      /* not JSON */
    }
  }
  return {}
}

/**
 * Two-step delete-account flow: consequences → emailed 6-digit code. Always
 * mounted + state-driven (the shadcn Dialog root wires Back-gesture close).
 */
export function DeleteAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { signOut } = useClerk()

  const [step, setStep] = useState<"confirm" | "otp">("confirm")
  const [summary, setSummary] = useState<DeleteSummary | null>(null)
  const [maskedEmail, setMaskedEmail] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [resendWait, setResendWait] = useState(0)

  // 1s countdown for the resend cooldown.
  useEffect(() => {
    if (resendWait <= 0) return
    const id = setTimeout(() => setResendWait(resendWait - 1), 1000)
    return () => clearTimeout(id)
  }, [resendWait])

  // Reset + load the consequences summary each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setStep("confirm")
    setSummary(null)
    setCode("")
    setError(null)
    setUnavailable(false)
    setResendWait(0)
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        setSummary(await apiGet<DeleteSummary>("/api/account/delete/summary", token))
      } catch {
        toast.error(t("deleteAccount.loadFailed"))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open
  }, [open])

  const requestCode = async (): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const res = await apiPost<{ email: string }>("/api/account/delete/request-code", token, {})
      setMaskedEmail(res.email)
      setResendWait(60)
      return true
    } catch (err) {
      const payload = apiErrorPayload(err)
      if (payload.code === "email_unavailable") {
        setUnavailable(true)
        return true // still advance; the OTP step renders the unavailable notice
      }
      if (payload.code === "cooldown") {
        setResendWait(payload.retry_after ?? 60)
        return true
      }
      setError(t("deleteAccount.emailFailed"))
      return false
    } finally {
      setBusy(false)
    }
  }

  const handleContinue = async () => {
    if (await requestCode()) setStep("otp")
  }

  const handleConfirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost("/api/account/delete/confirm", token, { code })
      toast.success(t("deleteAccount.deleted"))
      setActiveOrgId(null)
      try {
        await signOut()
      } catch {
        /* the server session may already be gone — local state is cleared regardless */
      }
      window.location.replace("/")
    } catch (err) {
      const payload = apiErrorPayload(err)
      setCode("")
      if (payload.code === "invalid_code") setError(t("deleteAccount.invalidCode", { count: payload.attempts_left ?? 0 }))
      else if (payload.code === "expired") setError(t("deleteAccount.expiredCode"))
      else if (payload.code === "too_many_attempts") setError(t("deleteAccount.tooManyAttempts"))
      else setError(t("deleteAccount.failed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-md">
        {step === "confirm" ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-destructive">{t("deleteAccount.dialogTitle")}</DialogTitle>
              <DialogDescription>{t("deleteAccount.consequences")}</DialogDescription>
            </DialogHeader>
            {summary === null ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {summary.organizations.map((org) => (
                  <div key={org.id} className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
                    <Building2 className="size-4 mt-0.5 shrink-0 text-destructive" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {org.is_personal ? t("deleteAccount.personalWorkspace") : org.name}
                      </p>
                      {org.member_count > 1 && (
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="size-3" />
                          {t("deleteAccount.memberCount", { count: org.member_count })}
                        </p>
                      )}
                      {org.has_active_premium && (
                        <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="size-3" />
                          {t("deleteAccount.premiumWarning")}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                {summary.other_memberships > 0 && (
                  <p className="text-xs text-muted-foreground px-1">
                    {t("deleteAccount.membershipsRemoved", { count: summary.other_memberships })}
                  </p>
                )}
                <p className="text-xs text-muted-foreground px-1">{t("deleteAccount.finalWarning")}</p>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button variant="destructive" onClick={handleContinue} disabled={busy || summary === null}>
                {busy ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : null}
                {t("deleteAccount.continue")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-destructive">{t("deleteAccount.otpTitle")}</DialogTitle>
              <DialogDescription>
                {unavailable ? t("deleteAccount.unavailable") : t("deleteAccount.otpSent", { email: maskedEmail })}
              </DialogDescription>
            </DialogHeader>
            {!unavailable && (
              <div className="flex flex-col items-center gap-3 py-2">
                <MailCheck className="size-8 text-muted-foreground" />
                <InputOTP maxLength={6} value={code} onChange={setCode} disabled={busy}>
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <InputOTPSlot key={i} index={i} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
                {error && <p className="text-sm text-destructive text-center">{error}</p>}
                <Button variant="link" size="sm" className="text-muted-foreground" disabled={busy || resendWait > 0} onClick={requestCode}>
                  {resendWait > 0 ? t("deleteAccount.resendIn", { seconds: resendWait }) : t("deleteAccount.resend")}
                </Button>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                {t("common.cancel")}
              </Button>
              {!unavailable && (
                <Button variant="destructive" onClick={handleConfirm} disabled={busy || code.length !== 6}>
                  {busy ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : null}
                  {busy ? t("deleteAccount.deleting") : t("deleteAccount.confirmButton")}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

### Task 11: ProfilePage danger zone + EN i18n

**Files:**
- Modify: `src/pages/ProfilePage.tsx`
- Modify: `src/lib/i18n/locales/en.json` (`"profile"` block, after `"legalTitle"` line ~533)

- [ ] **Step 1: Wire the page.** Add imports (`Trash2` to the lucide list on line 20; `import { DeleteAccountDialog } from "@/components/DeleteAccountDialog"`), add state next to the others: `const [deleteOpen, setDeleteOpen] = useState(false)`. After the Logout `</Card>` (line 392, still inside the account `TabsContent`) add:

```tsx
          <Card className="border-destructive/20 bg-destructive/5">
            <CardHeader>
              <CardTitle className="text-destructive">{t("profile.deleteAccount.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">{t("profile.deleteAccount.cardDescription")}</p>
              <Button variant="destructive" onClick={() => setDeleteOpen(true)} className="w-full">
                <Trash2 className="size-4 mr-2" />
                {t("profile.deleteAccount.button")}
              </Button>
            </CardContent>
          </Card>
```

and after `</Tabs>` (line 394, page root — keeps the dialog mounted regardless of tab):

```tsx
      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
```

**Note:** the dialog's own strings use `t("deleteAccount.…")` (default-namespace ROOT), while the card uses `profile.deleteAccount.…` — pick ONE. Use root-level `deleteAccount` for everything (matches the dialog code in Task 10): the card strings become `t("deleteAccount.title")`, `t("deleteAccount.cardDescription")`, `t("deleteAccount.button")`, and the keys live in a NEW top-level `"deleteAccount"` object in `en.json`, not inside `"profile"`.

- [ ] **Step 2: EN keys.** Add a top-level `"deleteAccount"` object to `en.json` (next to `"profile"`):

```json
  "deleteAccount": {
    "title": "Delete account",
    "cardDescription": "Permanently delete your account, every organization you own, and all their data. This cannot be undone.",
    "button": "Delete account…",
    "dialogTitle": "Delete your account?",
    "consequences": "This will permanently delete everything below — organizations you own, their clients, transactions, quotations and files.",
    "personalWorkspace": "Personal workspace",
    "memberCount_one": "{{count}} member — they will lose access",
    "memberCount_other": "{{count}} members — they will lose access",
    "premiumWarning": "Premium subscription — cancelled immediately, no refund",
    "membershipsRemoved_one": "You will also be removed from {{count}} organization you're a member of.",
    "membershipsRemoved_other": "You will also be removed from {{count}} organizations you're a member of.",
    "finalWarning": "This action is permanent and cannot be undone.",
    "continue": "Continue",
    "otpTitle": "Enter the confirmation code",
    "otpSent": "We emailed a 6-digit code to {{email}}. Enter it to permanently delete your account.",
    "resend": "Resend code",
    "resendIn": "Resend in {{seconds}}s",
    "confirmButton": "Delete my account forever",
    "deleting": "Deleting…",
    "invalidCode_one": "Wrong code — {{count}} attempt left",
    "invalidCode_other": "Wrong code — {{count}} attempts left",
    "expiredCode": "That code expired. Request a new one.",
    "tooManyAttempts": "Too many wrong attempts. Request a new code.",
    "unavailable": "Account deletion is currently unavailable. Please contact support.",
    "deleted": "Your account has been deleted",
    "failed": "Couldn't delete your account. Please try again.",
    "emailFailed": "Couldn't send the code. Please try again.",
    "loadFailed": "Couldn't load account details"
  }
```

- [ ] **Step 3: Translate to the 7 other locales** via `scripts/i18n-merge.mjs` (same workflow as Task 2 Step 5, file `$CLAUDE_JOB_DIR/tmp/i18n-delete-account.json`).
- [ ] **Step 4:** `npm run i18n:check` → exit 0. `npm run typecheck` → exit 0. `npx vitest run src/lib/account-otp.test.ts` → PASS.

### Task 12: Docs touch-up

- [ ] **Step 1:** Add rows to the CLAUDE.md "Newer routes" table: `/api/account/delete/summary|request-code|confirm` (self-serve account deletion, email OTP) and `/api/trash/clear` (purge all trash). Also add `RESEND_API_KEY` / `EMAIL_FROM` to the CLAUDE.md Environment section (they were undocumented).

### Task 13: Verify, sync native, commit, push (account branch)

- [ ] **Step 1: Full browser verification** with a THROWAWAY Clerk dev user (`something+clerk_test@example.com` auto-verifies) — see appendix. Walk: sign up → create data → Profile → Account → Delete account → consequences list correct → continue → (if Resend is configured in the cloud Development env the email actually sends; otherwise insert a known code hash directly:

```bash
node -r dotenv/config --input-type=module -e "import('@neondatabase/serverless').then(async ({neon}) => { const sql = neon(process.env.DATABASE_URL); const { createHash } = await import('node:crypto'); const uid = process.argv[1]; const hash = createHash('sha256').update(uid + ':123456').digest('hex'); await sql\`insert into account_deletion_codes (user_id, code_hash, expires_at, attempts, last_sent_at) values (\${uid}, \${hash}, now() + interval '10 minutes', 0, now() - interval '2 minutes') on conflict (user_id) do update set code_hash = \${hash}, expires_at = now() + interval '10 minutes', attempts = 0\`; console.log('code 123456 armed for', uid) })" dotenv_config_path=.env.local <CLERK_USER_ID>
```

) → enter code → account deleted → signed out on landing page → sign-in with the same credentials fails (Clerk user gone). Verify in DB: no `user_profiles` / `organizations` / `organization_members` / `notifications` rows for the user. Verify wrong-code decrements attempts and 6th attempt returns 429.
- [ ] **Step 2:** Run the DB-verification queries for the admin path too if time permits (admin delete of a seeded user now returns `{ok:true}`).
- [ ] **Step 3: Native parity** — `npm run cap:sync:android && npm run cap:sync:ios`.
- [ ] **Step 4: Commit** (two commits: backend + frontend, or one — every commit must pass the full gate):

```bash
git add -A
git commit -m "feat(account): self-serve delete account with email OTP; fix admin delete billing leak

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push** — `git push -u origin feat/account-delete-maqbool`. Report both PR compare URLs. Flag in the PR body: admin user-delete now ALSO deletes the Clerk user (behavior change), and prod needs `RESEND_API_KEY` + `EMAIL_FROM` set or the flow 503s.

---

## Appendix: Verification environment

- `vercel dev` serves frontend + API on :3000 and reads the CLOUD Development env (has Clerk dev keys; may have `RESEND_API_KEY`). Memory warning: `vercel dev` has hit EMFILE here (big native trees) — if it does, run `npm run dev` (Vite :5173, no API) for pure-UI checks and drive API routes with `curl` + a session token, or retry `vercel dev` after closing other watchers.
- Clerk dev sign-up: `anything+clerk_test@example.com` auto-verifies (no code). 2FA test code is `424242`.
- Local `DATABASE_URL` == cloud Dev DB. NEVER run these flows against prod.
- Browser automation: Playwright/Chrome MCP; remember `VITE_DISABLE_DEV_TOOLS` if the dev toolbar intercepts clicks.

## Task order

Part 1 (Tasks 1–3) and Part 2 (Tasks 4–13) are independent; run Part 1 first (smaller). Within Part 2 the order is strict: migration → lib → email → helper → routes → admin refactor → UI → i18n → verify.
