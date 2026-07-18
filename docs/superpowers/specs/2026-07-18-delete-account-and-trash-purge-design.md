# Delete Account (email-OTP) + Clear Trash — Design

**Date:** 2026-07-18 · **Status:** Approved by user · **Branches:** `feat/account-delete-maqbool`, `feat/trash-clear-maqbool` (both off `dev`, independent)

## Decisions (user-confirmed)

1. **Owned orgs with other members:** deletion proceeds anyway — every org the user owns is torn down (members lose access). The consequences step lists affected orgs + member counts first.
2. **Clear trash scope:** one header button purges ALL trashed types (clients, quotations, transactions) in the active org after one confirmation.
3. **Billing:** active Dodo subscriptions on owned orgs are cancelled immediately (no refund), matching `teardownOrganization()`; the modal copy says so.
4. **OTP mechanism:** app-owned 6-digit code emailed via the existing Resend integration (`api/_lib/email.ts`). Not Clerk reverification (experimental in installed version; fragile in native WebView), not link-based (user asked for OTP).

---

## Feature 1 — Delete Account

### UI (`src/pages/ProfilePage.tsx`, account tab)

- New **Danger zone** card below the Logout card: destructive-tinted, title + copy explaining permanence, "Delete account" button.
- One **always-mounted, state-driven Dialog** (back-close convention; never conditionally mounted) with two steps:
  - **Step 1 — Consequences:** fetched from `GET /api/account/delete/summary` — orgs the user owns (name, member count, `premium` flag → "subscription cancelled immediately, no refund"), count of memberships that will be removed, note that all clients/transactions/quotations/attachments are permanently deleted. Destructive "Continue" button.
  - **Step 2 — OTP:** on entering this step the client calls `request-code`; shows "We emailed a 6-digit code to {maskedEmail}", an `input-otp` field (install via `npx shadcn@latest add input-otp`), a Resend link with 60 s cooldown, and "Delete my account forever" (disabled until 6 digits).
- On success: clear API cache/local org state, Clerk `signOut()`, hard redirect to `/`.
- If `request-code` returns 503 (email not configured): step 2 shows "Account deletion is currently unavailable — contact support".

### API

New routes (consolidated router, static entries under `["account","delete",…]`):

| Route | Method | Behavior |
|---|---|---|
| `/api/account/delete/summary` | GET | `requireAuth`; returns owned orgs (id, name, member_count, has_active_premium), other-org membership count |
| `/api/account/delete/request-code` | POST | `requireAuth`; 60 s resend cooldown (429 + retry_after); reads primary email from Clerk `users.getUser`; generates 6-digit code (`crypto.randomInt`); upserts `account_deletion_codes` (sha256 hash only, 10-min expiry, attempts reset); sends email via `sendEmail()`; 503 if `!isEmailConfigured()` |
| `/api/account/delete/confirm` | POST | `requireAuth`; body `{ code }`; verifies row exists, not expired, attempts < 5 (else 429), constant-time hash compare (mismatch increments attempts → 400); on match deletes the code row and runs `deleteUserAccount(userId)` |

### Data (migration 0053)

`account_deletion_codes`: `user_id` text PK, `code_hash` text NOT NULL (sha256 of `userId:code`), `expires_at` timestamptz NOT NULL, `attempts` integer NOT NULL DEFAULT 0, `last_sent_at` timestamptz NOT NULL, `created_at` timestamptz DEFAULT now(). ⚠ Journal `when` must be bumped above 0052's (drizzle journal gotcha), then verify the table exists in `information_schema`.

### `deleteUserAccount(userId)` — shared helper (`api/_lib/account-delete.ts`)

Order matters:

1. For each org where `owner_user_id = userId`: repoint other users' `current_organization_id` (to their own personal org if one exists, else NULL), then `teardownOrganization(orgId)` (existing helper: cancels Dodo first, explicit client/quotation deletes, org cascade).
2. Delete the user's `organization_members` rows in orgs they don't own.
3. Delete user-scoped rows with no FK cascade: `push_subscriptions`, `push_events`, `legal_acceptances`, `referral_codes`, `referrals` (both `referrer_user_id` and `referred_user_id`), `payout_requests`, `app_admins`, user-scoped `notifications` / `notification_preferences` / `notification_reminders` rows (any with a `user_id` column; verify against schema at implementation). `broadcasts`/`user_groups`/`blog_posts` authored by the user stay (platform content); `audit_logs.actor_user_id` history stays (org-scoped, already handled by teardown).
4. Delete `user_profiles`.
5. Delete the Clerk user (`users.deleteUser`, one retry). **Last**, because `/api/profile` upserts on first call — a surviving Clerk user could silently resurrect an empty account. If Clerk deletion still fails: return 500 "deletion incomplete, retry"; DB is already clean, retrying is safe (all steps idempotent).

**Included fix:** refactor the admin user-delete (`api/_routes/admin/users.ts` DELETE, lines ~230–281) onto this helper. Fixes two live bugs: owned-org deletion skips Dodo cancellation (customers keep being billed) and user-scoped rows are orphaned. Admin deletion now also deletes the Clerk user (true deletion — flagged in PR description as a behavior change).

### Pure logic + tests (DB-free gate)

`src/lib/account-otp.ts` (server-safe, uses `node:crypto`, never imported by frontend): `hashDeletionCode(userId, code)`, `verifyDeletionCode(row, userId, code, now)` → `valid | expired | too_many_attempts | mismatch`, `resendAllowedAt(row)`, `maskEmail(email)`. Unit tests in `src/lib/account-otp.test.ts` (no DB).

---

## Feature 2 — Clear Trash

### API

`POST /api/trash/clear` (`api/_routes/trash/clear.ts`, router entry `["trash","clear"]` before any dynamic sibling): `requireAuth` + `canDelete(role)`. Purges everything trashed in the active org **preserving the existing invariants** by reusing/extracting the per-type logic from `purge.ts`:

1. Trashed **clients** first — reverse wealth balances for their LIVE transactions only (soft-deleted ones were reversed at soft-delete time), then hard-delete (transactions/attachments cascade).
2. Remaining trashed **transactions** (live clients) — split-group-aware delete, no balance touch.
3. Trashed **quotations** — hard-delete (attachments/pdfs cascade).

Returns `{ purged: { clients, quotations, transactions } }`.

### UI (`src/pages/TrashPage.tsx`)

"Clear trash" destructive-outline button in the page header (≥44 px target), hidden when total trashed count is 0. One AlertDialog: "Clear trash? All {{count}} items will be permanently deleted. This cannot be undone." → working state → refetch + success toast. Per-record delete-forever stays as is.

---

## Cross-cutting

- **i18n:** all new strings in `en.json` first, then all 7 other locales (gate blocks otherwise). New keys under `profile.*`/`account.*` (delete-account) and the `trash` namespace (clear).
- **Verification:** unit tests for OTP logic; browser walkthrough of both flows (`vercel dev`; if Resend key absent locally, insert a known code's hash into the local DB to complete the confirm step); full pre-commit gate.
- **Native parity (strict):** `npm run cap:sync:android` + `npm run cap:sync:ios` on both branches (web bundle changes).
- **Push policy:** feature branches pushed; user opens PRs (gh CLI unauthenticated). Never push `dev`.

## Error handling summary

| Failure | Behavior |
|---|---|
| Email not configured | 503 on request-code; UI shows "unavailable, contact support" |
| Wrong OTP | attempts+1, 400; after 5 → 429 until a new code is requested |
| Expired OTP | 400 with expired reason; UI offers resend |
| Clerk delete fails after DB wipe | 500 "retry"; helper is idempotent, retry completes |
| Clear-trash partial failure | requests are sequential server-side; error → 500, client refetches (remaining items still shown) |
