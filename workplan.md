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
| 4 | Admin invoices: visible + clickable + viewable | `fix/admin_invoices_viewable_maqbool` | https://github.com/vorreix/profitsync/compare/main...fix/admin_invoices_viewable_maqbool?expand=1 | ✅ |
| 1 | Admin custom roles & privileges (viewer/editor/blog-writer) | `feature/admin_custom_roles_maqbool` | https://github.com/vorreix/profitsync/compare/main...feature/admin_custom_roles_maqbool?expand=1 | ✅ |
| 3 | Org invitations: email + shareable link + 3 accept flows | `feature/org_invitations_email_flow_maqbool` | https://github.com/vorreix/profitsync/compare/main...feature/org_invitations_email_flow_maqbool?expand=1 | ✅ |
| 5 | Landing vs app split + PWA app-only + seamless auto-update | `feature/landing_pwa_split_maqbool` | https://github.com/vorreix/profitsync/compare/main...feature/landing_pwa_split_maqbool?expand=1 | ✅ |

Order of execution: **2 → 4 → 1 → 3 → 5** (small/isolated first, schema+infra later).

**Status: all 5 tasks implemented, verified (typecheck + eslint + build + 64 tests + Playwright UI),
committed and pushed.** Branches are each off `main`; open each PR from its compare URL above (or
target `dev` — currently identical to `main`). New env to set in production for Task 3 email:
`RESEND_API_KEY` + `EMAIL_FROM` (optional — invites fall back to a copyable link without them).
**Merge note:** Task 1 and Task 4 both edit `api/_routes/admin/invoices.ts`; on merge keep Task 1's
`requireAdminCap` guard **and** Task 4's `handleDocument` action (trivial combine).

**Post-review:** an adversarial multi-agent review of all 5 branches ran after implementation. It
found one real bug — a privilege escalation in `admin/users.ts` (an editor could promote users to
admin / delete accounts under the `write` cap) — fixed on the Task 1 branch (now requires
`manage_admins`; verified editor→403, super_admin→200). Two raised "email escaping" findings were
rejected as false positives (the email subject/plain-text are correctly NOT HTML-escaped; only the
HTML body is).

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

### Task 4 — admin invoices viewable ✅
- API: admin-scoped `GET /api/admin/invoices?invoice_id&document=1` (`handleDocument`) → stored URL or proxied Dodo PDF; 404 when none. UI: clickable rows → Invoice detail dialog (all fields) + **View invoice document** + per-row View button + status editor.
- typecheck/lint/build/64 tests ✅. Playwright (6 real Dodo invoices): View → `200 OK` PDF blob opened in new tab. Screenshot `task4-admin-invoice-detail.png`.
- ⚠️ Merge note: both Task 4 and Task 1 edit `api/_routes/admin/invoices.ts` (Task 4 adds the document action; Task 1 swaps the guard to `requireAdminCap`). Trivial conflict — keep both: Task 1's method-aware guard + Task 4's `handleDocument`.

### Task 1 — admin custom roles & privileges ✅
- Shared `src/lib/admin-roles.ts`: roles `super_admin | editor | viewer | blog_writer` → capability sets `{read, write, blog, settings, manage_admins}` (`adminCan`, metadata). Imported by both API and client.
- Migration `0024`: additive `app_admins.role text not null default 'super_admin'` (applied to dev DB; every existing admin stays super_admin — zero disruption).
- API: `getAdminRole` + `requireAdminCap(req,res,cap)` in `api/_lib/admin.ts`; **all 19 admin routes** method-guarded (GET→read, mutations→write; blog routes→blog; plans/referral-settings→settings; payouts/[id]→settings; admins→manage_admins). `/api/admin/me` returns `{role, caps}`. `admins.ts` adds role on create/PATCH + last-super-admin lockout guard; root-email admins locked to super_admin.
- UI: `AdminProvider` exposes `role/caps/can`; shared `admin-nav.ts` (per-item cap) filters the sidebar; `RequireAdminCap` route guard redirects to the first allowed section; `AdminAdminsPage` gains a role picker (add) + per-admin role dropdown + role badges. `make-admin.mjs` gains `--role`.
- typecheck/lint/build/64 tests ✅. Playwright verified all three derived roles:
  - **blog_writer**: nav shows only Blog; `/admin` → redirects to `/admin/blog`; API `blog GET 200`, `users/plans GET 403`.
  - **viewer**: nav = Overview/Users/Orgs/Subs/Invoices/Referrals (no Plans/Blog/Admins); API `users GET 200`, `users PATCH 403`, `plans GET 200`, `plans PATCH 403`, `admins GET 403`, `blog GET 403`.
  - **super_admin**: full nav + Admins page with role pickers; root admin locked. Screenshot `task1-admin-roles.png`.

### Task 3 — org invitations: email + shareable link + 3 accept flows ✅
- Email infra: `api/_lib/email.ts` (Resend via HTTP, no SDK dep) — `sendInvitationEmail` (branded HTML+text). Env `RESEND_API_KEY` + `EMAIL_FROM` documented in `.env.example`. Best-effort: missing key → `emailed:false`, link still returned.
- `organizations/[id]/members.ts` POST now sends the email (origin derived from request) and returns `{ ...invite, link, emailed }`; re-invites keep the existing token. Accept endpoint (`invitations/[token].ts`) now **always** sets `current_organization_id = invited org` + stamps `onboarded_at` so new invitees land in the joined org and skip onboarding.
- Redirect preservation: `safe-redirect.ts` (open-redirect-safe); `LoginPage`/`SignupPage` honor `?redirect=` via Clerk `forceRedirectUrl`/`signUpUrl`/`signInUrl`; `SignupPage` prefills `?email=`. `InvitationPage` rewritten: signed-out → Sign in / Create account (carry redirect+email); on accept → `setActiveOrgId(org)` + go to dashboard; email-mismatch → warning + "Use a different account". `OrgMembersPage` shows emailed-vs-copy-link toast.
- typecheck/lint/build/64 tests ✅. Playwright:
  - **Invite API** (Acme owner): POST → `201` with `link` + `emailed:false` (no crash without RESEND key).
  - **Scenario 3** (logged in → accept): seeded invite into "VorreiX" → Accept → `localStorage.ps_active_org` switched to VorreiX + dashboard shows **VorreiX** (landed in joined org).
  - **Scenario 1** (new user): signed-out invite → "Create an account" → `/signup?redirect=…&email=…` → Clerk email field **prefilled**.
  - **Scenario 2** (logged-out existing): "Sign in to accept" → `/login?redirect=…`; Clerk signup link carries the redirect.
  - **Redirect-after-auth**: completed a fresh Clerk signup through the invite's redirect → bounced back to `/invitations/:token` automatically.
  - **Email mismatch**: signed in as a non-invited email → clear warning + "Use a different account". Screenshot `task3-invitation-mismatch.png`.

### Task 5 — landing visible when logged in + PWA app-only + seamless auto-update ✅
- `src/lib/pwa/is-standalone.ts`: strict installed-app detector (display-mode standalone/fullscreen/minimal-ui/WCO + iOS `navigator.standalone`) — deliberately ignores the "was installed" localStorage flag so an installed user browsing in a normal tab still sees the landing.
- `App.tsx` `LandingRoute`: in a browser, **always render the landing** (incl. signed-in users); only when running standalone redirect `/` → `/dashboard` (signed in) or `/login` (signed out). The installed PWA never shows the marketing landing.
- `pwa/vite-pwa.ts`: `skipWaiting:true` + `clientsClaim:true` → a freshly deployed SW activates immediately and claims open tabs (seamless auto-update). Kept the silent `updateSW(false)`, hourly update check, and the `vite:preloadError` single-reload guard; `start_url`/`scope`/`id` unchanged so existing installs aren't duplicated. SW only precaches hashed static assets.
- Landing `Navbar`: signed-in users get a **Go to dashboard** CTA (desktop + mobile) instead of Login/Get-started; `nav.goToDashboard` added to landing en.json (defaultValue covers other locales).
- typecheck/lint/build/64 tests ✅. Generated `dist/sw.js` contains `skipWaiting()` + `clientsClaim()`.
- Playwright (signed in as a test user):
  - **Browser**: `/` stays on the landing (no redirect) with **Go to dashboard** shown, Login/Get-started hidden.
  - **Standalone emulated** (matchMedia override active): SPA-navigating to `/` redirected into the app (`/dashboard` → `/onboarding`), never the landing. Screenshot `task5-landing-signed-in.png`.
