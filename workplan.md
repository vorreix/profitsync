# ProfitSync — Work Plan (5 tasks)

> Autonomous execution. Each task = its own branch off `main` + its own PR. `gh` is **not**
> authenticated in this environment, so branches are pushed and PRs are opened from the GitHub
> **compare URLs** recorded below. Every task is verified with `npm run typecheck` + `npm run lint`
> + `npm run build` + `npm run test:ci`, plus targeted Playwright UI checks where a UI flow changed.
>
> Repo: `vorreix/profitsync` · base branch: `main` · dev server: `vercel dev` on `:3000`.
> Conventions honored (from CLAUDE.md): org-scope every query, `serialize()` rows, ESM `.js`
> imports in `api/**`, additive migrations with defaults, role checks before writes, quota checks
> before creates, all UI strings via `useTranslation()` (en.json first).

## Branch ledger (merge order is independent — tasks don't depend on each other)

| # | Task | Branch | PR compare URL | Status |
|---|------|--------|----------------|--------|
| 2 | Fix transaction category dropdown scroll/overflow | `fix/tx_category_dropdown_scroll_maqbool` | https://github.com/vorreix/profitsync/compare/main...fix/tx_category_dropdown_scroll_maqbool?expand=1 | ✅ |
| 4 | Admin invoices: visible + clickable + viewable | `fix/admin_invoices_viewable_maqbool` | _tbd_ | ☐ |
| 1 | Admin custom roles & privileges (viewer/editor/blog-writer) | `feature/admin_custom_roles_maqbool` | _tbd_ | ☐ |
| 3 | Org invitations: email + shareable link + 3 accept flows | `feature/org_invitations_email_flow_maqbool` | _tbd_ | ☐ |
| 5 | Landing vs app split + PWA app-only + seamless auto-update | `feature/landing_pwa_split_maqbool` | _tbd_ | ☐ |

Order of execution: **2 → 4 → 1 → 3 → 5** (small/isolated first, schema+infra later).

---

## Task 2 — Transaction category dropdown: not scrollable, leaks downward
**Branch:** `fix/tx_category_dropdown_scroll_maqbool`

**Root cause:** `CategoryCombobox` (`src/pages/TransactionsPage.tsx:120`) and `CategoryPicker`
(`src/components/CategoryPicker.tsx`) put their option list inside a Radix `ScrollArea` with
`max-h-52`/`max-h-56`. The shadcn `ScrollArea` viewport uses `size-full` (height:100%); a percentage
height does **not** resolve against a parent whose height is only `max-height` (computed height stays
`auto`), so the viewport grows with content instead of scrolling — the popover overflows below the
viewport. It's rendered in a Portal inside a scrollable Dialog, so there's no collision rescue.

**Fix:**
- Replace the `ScrollArea` wrapper with a plain `<div className="max-h-56 overflow-y-auto overscroll-contain">` (reliable bounded scroll, no percentage-height dependency).
- Bound the popover itself: add `max-h-[--radix-popover-content-available-height]` + flex column to the `PopoverContent` so it never exceeds the viewport, with the list as the only growing/scrolling child. Keep the search box pinned.
- Apply to **both** `CategoryCombobox` (TransactionsPage) and `CategoryPicker` (ClientDetailPage), and audit `ClientCombobox` (Command list) for the same.
- Radix `Select` (income/expense filter) already uses `max-h-(--radix-select-content-available-height)` → fine; no change.

**Verify:** typecheck/lint/build/test; Playwright — open Add Transaction, open category dropdown with many categories, confirm it scrolls inside a bounded popover and never overflows past the dialog/viewport at 375px + desktop.

---

## Task 4 — Admin invoices not visible / not clickable / can't view the invoice
**Branch:** `fix/admin_invoices_viewable_maqbool`

**Current:** `AdminInvoicesPage` renders a table (id truncated, org, amount, status, dates) whose only
action is **Edit** (status only). There is **no way to open the actual invoice document**. `pdfUrl`
is intentionally `null` for Dodo invoices (proxied through our API key). The user-facing
`/api/billing/invoice-pdf?id=` is **org-scoped** — an admin can't use it for arbitrary orgs.

**Fix:**
- New admin endpoint `GET /api/admin/invoices` action to resolve a viewable document for any org:
  `?invoice_id=<id>&document=1` → returns `{ url }` when `pdf_url` is stored, else proxies the Dodo
  invoice PDF (resolve env from the invoice's subscription) and streams `application/pdf`; 404 with a
  clear message when none exists. (Reuses `fetchInvoicePdf` from `api/_lib/dodo.ts`.)
- Make each row **clickable** → opens an invoice **detail dialog** showing every field (full id,
  org + owner, amount, status, provider, provider invoice id, issued/paid/created) with a prominent
  **View / Download invoice** button (opens the document in a new tab) and the existing status editor.
- Improve visibility: full id copyable, clearer empty-state, loading state on the View button, mobile-friendly layout.

**Verify:** typecheck/lint/build/test; Playwright — open `/admin/invoices`, click a row, see detail dialog, click View (handle the no-document case with a toast).

---

## Task 1 — Admin custom roles & privileges (viewer · editor · blog writer · super admin)
**Branch:** `feature/admin_custom_roles_maqbool`

**Current:** `app_admins` is `{ userId, createdAt }` — binary. `requireAdmin()` gates all 19 admin
routes uniformly; `AdminLayout` shows every nav item to anyone who is an admin.

**Design (shared role→capability map, used by both API and client):**
- New `src/lib/admin-roles.ts` (imported by API as `.js`): `AdminRole = 'super_admin' | 'editor' | 'viewer' | 'blog_writer'`; `ADMIN_CAPS` map → `{ read, write, blog, settings, manageAdmins }`; `can(role, cap)` helper. Root-email admins ⇒ `super_admin`.
- Migration: add `role text not null default 'super_admin'` to `app_admins` (existing admins keep full access — zero disruption). `db:generate` → apply.
- `api/_lib/admin.ts`: `getAdminRole(userId)` (root ⇒ super_admin, else row role, else null); `requireAdminCap(req,res,cap)` returns `{ userId, role }` or writes 403. Keep `requireAdmin` (= read cap) for back-compat.
- Routes: blog routes → `blog` cap; plans/referral-settings → `settings`; admins CRUD → `manageAdmins`; all list/read routes → `read`; every mutation guarded by `write` (or its specific cap).
- `/api/admin/me` returns `{ userId, role, caps }`. `AdminProvider`/`useAdmin()` exposes `role` + `caps`. `AdminLayout` nav filtered by caps; `AdminGuard` unchanged (any admin can enter; pages/links gated).
- `AdminAdminsPage` + `admins.ts`: role picker on add, role badge + inline role change (only `manageAdmins`); root admins locked to super_admin.
- `scripts/make-admin.mjs`: optional `--role`.
- i18n for new admin UI strings.

**Edge cases:** can't demote/remove the last super_admin; root-email admins always super_admin and unmodifiable; a blog_writer hitting a non-blog route → 403 (and the link is hidden).

**Verify:** typecheck/lint/build/test; route-guard smoke (each cap → allowed/forbidden); Playwright — sign in as super admin, set a second admin to blog_writer, confirm nav + route gating.

---

## Task 3 — Organization invitations: real email + shareable link + 3 accept flows
**Branch:** `feature/org_invitations_email_flow_maqbool`

**Current gaps:** invite POST only writes a DB row (no email). Shareable link exists (copy button).
`LoginPage`/`SignupPage` hardcode `fallbackRedirectUrl="/dashboard"` and ignore `?redirect=`.
`InvitationPage` accept navigates to `/dashboard` **without switching to the invited org**, and the
accept endpoint only sets `currentOrganizationId` when it was null.

**Fix:**
1. **Email infra:** new `api/_lib/email.ts` using **Resend** (HTTP API, fits serverless; no SMTP).
   Env: `RESEND_API_KEY`, `EMAIL_FROM` (+ documented in `.env.example`). Best-effort: invite creation
   still succeeds if email send fails (link is shown/copyable as fallback). `sendInvitationEmail({ to, orgName, inviterName, role, link, expiresAt })` — clean branded HTML + text.
2. **Send on invite:** `organizations/[id]/members.ts` POST calls `sendInvitationEmail` after creating/refreshing the invite; response includes `{ token, email, emailed: boolean }`. Keep the shareable link.
3. **Redirect preservation:** `LoginPage` + `SignupPage` read `?redirect=` (validated to a safe in-app path) and pass Clerk `forceRedirectUrl`/`signUpForceRedirectUrl`. `SignupPage` also prefills the invited email (`initialValues`) when `?email=` is present.
4. **InvitationPage flows:** when signed out, show **Sign in to accept** (`/login?redirect=/invitations/:token`) and **Create account** (`/signup?redirect=...&email=<invited>`). After auth, returning to `/invitations/:token` while signed-in auto-shows the accept/decline card (already the page's UI). On **accept**: set the invited org active client-side (`setActiveOrgId(org.id)`) and navigate to `/dashboard` so the user lands in **that org's** dashboard; surface the email-mismatch 403 clearly.
5. **Accept endpoint:** set `currentOrganizationId = invitation.organizationId` **always** on accept (joining an invite means "go there now"), so the dashboard shows the invited org.

**Edge cases:** invited email ≠ signed-in email (403 + guidance, prefill on signup); expired/declined/accepted invite (already handled, surfaced); new user with no profile (auto-created → current org = invited org → dashboard, skip personal onboarding when joining an org); Resend not configured in dev (no crash, link fallback).

**Verify:** typecheck/lint/build/test; Playwright — simulate all three: (a) brand-new signup via invite link → accept → invited org dashboard; (b) existing logged-out user → login via redirect → accept → invited org; (c) already logged-in → accept → invited org. Email send mocked/guarded in dev.

---

## Task 5 — Landing visible when logged in (browser) + PWA shows app only + seamless auto-update
**Branch:** `feature/landing_pwa_split_maqbool`

**Current:** `LandingRoute` redirects **any** signed-in visitor off `/` to `/dashboard`, so logged-in
users can't view the marketing landing in the browser. PWA: `start_url=/dashboard`, `scope=/`,
`registerType:'prompt'`, `skipWaiting:false`/`clientsClaim:false`, silent `updateSW(false)` on update.

**Fix:**
1. **Landing visible in browser when logged in:** change `LandingRoute` so it renders the landing for
   signed-in **browser** users (only redirect to `/dashboard` when running as an **installed PWA**).
   Add `isStandalonePwa()` util (display-mode standalone / iOS `navigator.standalone`). The landing's
   navbar shows **Go to Dashboard** for signed-in users (instead of Login/Get started).
2. **PWA = app only, never landing:** in standalone mode, `/` → `Navigate` to `/dashboard` (signed in)
   or `/login` (signed out); the marketing landing never renders inside the installed app. `start_url`
   stays `/dashboard`, `scope` stays `/`, `id` stays `/dashboard` (no manifest identity change → no
   duplicate installs for existing users).
3. **Seamless auto-update for existing installs:** set `clientsClaim:true` + `skipWaiting:true` in
   `pwa/vite-pwa.ts` so a freshly deployed SW activates immediately and claims open tabs; keep
   `updateSW(false)` (silent, no reload — fresh assets load on next navigation), the hourly update
   check, and the `vite:preloadError` single-reload recovery. `sw.js`/`manifest` already `no-cache`.
   Existing clients converge on next visit/hourly check; no data loss; chunk-error guard covers stale
   chunk refs.

**Edge cases:** stale `__client_uat` cookie (graceful — AppLayout re-guards); iOS standalone detection;
existing installs pre-update (converge via hourly check + claim); offline `/` in PWA stays denylisted
(app boots at `/dashboard` anyway); signed-in user loading landing pulls the landing bundle (intended).

**Verify:** typecheck/lint/build/test; `npm run build && npm run preview` to exercise the real SW;
Playwright — (a) signed-in browser at `/` sees landing with "Go to Dashboard"; (b) emulate standalone
(`display-mode: standalone`) → `/` redirects into the app; confirm SW registers and updates.

---

## Verification log

### Task 2 — category dropdown scroll/overflow ✅
- `CategoryCombobox` (TransactionsPage) + `CategoryPicker` (ClientDetailPage): replaced the Radix `ScrollArea` (percentage-height viewport that never constrained → leaked downward) with a flex-column `PopoverContent` bounded to `min(20rem, --radix-popover-content-available-height)` + an `overflow-y-auto` list. Hardened `ClientCombobox` popover the same way. Removed now-unused `ScrollArea` imports.
- typecheck ✅ · lint ✅ · build ✅ · 64/64 tests ✅.
- Playwright (390×560 mobile, 19 categories): popover height capped at 320px, `overflow:hidden`, bottom 421 ≤ viewport 560 (no downward leak); inner list `scrollHeight 684 > clientHeight 269`, scroll moved 0→415 → **scrollable & bounded**. Screenshot `task2-category-scroll-fixed.png`.
