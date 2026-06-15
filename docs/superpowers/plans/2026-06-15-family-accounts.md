# Family Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: this epic is executed via the project's `work-finetuning` skill (stacked branches, mobile-first UX, optimistic in-place updates, Playwright verification, full pre-commit gate, a pushed branch per task). Steps use checkbox (`- [ ]`) syntax for tracking. Spec: `docs/superpowers/specs/2026-06-15-family-accounts-design.md`.

**Goal:** Add a third tenancy type — Family — a shared household workspace that links members who each keep a fully private personal account, with real shared balances, cross-org contribute/disburse transfers, whole-family premium, and first-class onboarding + landing presence.

**Architecture:** A Family is an `organizations` row with `account_type='family'` (`is_personal=false`), reusing `organization_members`, invitations, the org switcher, and per-org subscriptions. Each member also has a private personal org (one member each → no cross-visibility). The one new mechanic is a two-leg transfer that spans two orgs (personal ↔ family), found by `group_id`, with both balances updated and reversed together.

**Tech Stack:** React 19 + Vite, Drizzle/Neon Postgres, Vercel serverless (consolidated `api/index.ts` router), Clerk auth, Dodo Payments, i18next (8 locales), Vitest + Playwright, Tailwind v4 + shadcn/ui.

---

## Global invariants (every branch must preserve)

- All DB reads/writes scoped by `orgId` from `requireAuth`. Never scope by `userId` alone.
- `serialize(row)` before every `res.json(row)`.
- New `api/` relative imports use explicit `.js` extensions (ESM prod-parity).
- Every new `api/_routes/**` handler calls an auth guard (route-guard sweep).
- New API routes: create handler → import in `api/index.ts` → add to routes array (static before dynamic at same depth).
- Mutations clear/scope the GET cache (automatic via `api.ts`); add `/api/family` to `WEALTH_AFFECTING` in `data-events.ts`.
- i18n: add English keys first, propagate to all 7 other locales; `npm run i18n:check` must pass.
- Each branch ends green through the pre-commit gate and is pushed.
- **Personal-account privacy is the prime directive** — no code path may expose one member's personal accounts/transactions/balances to another. The family-org transfer leg stores only a Clerk user id (rendered as an already-known member name).

## File structure (whole epic)

**Schema / types / shared libs**
- `src/lib/db/schema.ts` — `user_profiles.family_org_id`; `transactions.family_transfer` + `family_party_user_id`.
- `drizzle/0046_*.sql` + `drizzle/meta/_journal.json` — migration (`when` > 1781470640739).
- `src/lib/types.ts` — `AccountType` += `family`; `accountTypeAllows`; `Family*` types.
- `src/lib/wealth-ledger.ts` — cross-org sibling reversal helper.
- `src/lib/family.ts` (new) — pure helpers (role mapping, one-family checks, attribution math) + `src/lib/family.test.ts`.
- `api/_lib/auth.ts` — family role mapping; `getUserFamilyOrgId` helper.
- `api/_lib/quota.ts` — `getOrgPlan` premium cascade; `checkFamilyMemberQuota`; `familyMembers` limit.

**API routes (`api/_routes/family/`)**
- `family.ts` — GET hub data; POST create family.
- `family/join.ts` — POST accept invite / join by code (one-family guard).
- `family/leave.ts` — POST leave / transfer-head.
- `family/transfer.ts` — POST (contribute|withdraw|disburse) + DELETE (reverse both legs).
- `family/contributions.ts` — GET attribution (by member).
- Extend `organizations/[id]/members.ts` + `invitations/[token].ts` for the one-family guard.

**Frontend**
- `src/pages/FamilyPage.tsx` (`/family` hub) + section components under `src/components/family/`.
- `src/components/onboarding/` — Family ChoiceCard + create/join sub-flows + accents.
- `src/pages/OnboardingPage.tsx`, `OrgSetupPage.tsx` — wire family path.
- `src/components/AppLayout.tsx`, `MobileAppLayout.tsx`, `OrgSwitcher.tsx`, `src/App.tsx` — nav/routes/gate.
- `src/landing/sections/` — segmentation pillar + Family section + pricing + FAQ.
- `src/lib/i18n/index.ts` + `locales/*.json` — `family` namespace.

**Worker (enhancement)**
- `worker/` — scheduled allowances + auto-contributions + family digests via trigger callback.

---

## Task 0 (branch `feat/family-00-foundation`): schema, types, gating, pure helpers

**Files:**
- Modify: `src/lib/db/schema.ts` (user_profiles, transactions)
- Create: `drizzle/0046_family_accounts.sql`, update `drizzle/meta/_journal.json`
- Modify: `src/lib/types.ts` (`AccountType`, `accountTypeAllows`)
- Create: `src/lib/family.ts`, `src/lib/family.test.ts`
- Modify: `api/_lib/auth.ts` (role mapping helpers), `src/lib/wealth-ledger.ts` (cross-org reversal note)

- [ ] **Step 1 — Failing test: `accountTypeAllows` family cases.** In `src/lib/family.test.ts` (or extend an existing types test), assert: family allows `members`, `spaces`, `family`; family denies `clients`, `quotations`; personal still denies `members`; business still denies `spaces`; the new `family` feature is allowed only for `family`.

```ts
import { describe, it, expect } from "vitest"
import { accountTypeAllows } from "@/lib/types"

describe("accountTypeAllows — family", () => {
  it("family: members+spaces+family yes, clients/quotations no", () => {
    expect(accountTypeAllows("family", "members")).toBe(true)
    expect(accountTypeAllows("family", "spaces")).toBe(true)
    expect(accountTypeAllows("family", "family")).toBe(true)
    expect(accountTypeAllows("family", "clients")).toBe(false)
    expect(accountTypeAllows("family", "quotations")).toBe(false)
  })
  it("personal/business unchanged; family gate is family-only", () => {
    expect(accountTypeAllows("personal", "members")).toBe(false)
    expect(accountTypeAllows("business", "spaces")).toBe(false)
    expect(accountTypeAllows("personal", "family")).toBe(false)
    expect(accountTypeAllows("business", "family")).toBe(false)
  })
})
```

- [ ] **Step 2 — Run, verify fail** (`family` feature + family branch not yet handled): `npx vitest run src/lib/family.test.ts`.
- [ ] **Step 3 — Implement types.** In `src/lib/types.ts`: `AccountType = "personal" | "business" | "family"`; add `"family"` to `ACCOUNT_TYPES`; add `"family"` to `GatedFeature`; update `accountTypeAllows`: `clients|quotations` business-only; `members` allowed for business+family; `spaces` allowed for personal+family; new `family` feature allowed only when `accountType==='family'`. Keep legacy/`null` = business default.
- [ ] **Step 4 — Run, verify pass.**
- [ ] **Step 5 — Schema.** Add to `src/lib/db/schema.ts`: `user_profiles.familyOrgId uuid → organizations.id (set null)`; `transactions.familyTransfer boolean not null default false`; `transactions.familyPartyUserId text`. Run `npm run db:generate`; confirm `drizzle/0046_*.sql` created; **bump its `_journal.json` `when` above 1781470640739**; verify columns via the migration SQL.
- [ ] **Step 6 — Pure helpers.** `src/lib/family.ts`: `familyRoleFromOrgRole(role): 'head'|'member'|'viewer'`; `orgRoleForFamilyRole(...)`; `sumContributionsByMember(legs)`; `isHead(role)`. Add tests for each in `family.test.ts`.
- [ ] **Step 7 — Auth helper.** `api/_lib/auth.ts`: `getUserFamilyOrgId(userId): Promise<string|null>` (reads `user_profiles.family_org_id`). No behavior change to `requireAuth`.
- [ ] **Step 8 — Run full gate** (`lint`, `typecheck`, `test:ci`), commit, push `feat/family-00-foundation`.

---

## Task 1 (branch `feat/family-01-membership`): create / join / leave + one-family guard

**Files:** `api/_routes/family.ts` (GET hub, POST create), `api/_routes/family/join.ts`, `api/_routes/family/leave.ts`, modify `api/_routes/invitations/[token].ts` + `organizations/[id]/members.ts` (guard), `api/index.ts` (register routes), `src/lib/types.ts` (`FamilyHub` type).

- POST `/api/family` (create): reject if caller's `family_org_id` set; `createOrgForUser({isPersonal:false, accountType:'family', name, currency})`; set `user_profiles.family_org_id`; ensure caller personal org exists. Returns family org.
- POST `/api/family/join`: accept invite token (reuse invitation logic) **or** code; reject if `family_org_id` set; insert `organization_members` (role `editor`); set `family_org_id`.
- POST `/api/family/leave`: clear `family_org_id`; remove membership; head must transfer head (body `{transfer_to}`) or delete family (last-owner guard).
- Guard in `invitations/[token].ts` accept + `members.ts` POST: if the target org is `account_type='family'` and the invitee already has `family_org_id`, return 409 with a clear message.
- GET `/api/family`: hub payload — family org, members (name/role/avatar), shared balances summary, family spaces, recent activity. (Detail aggregation can land in Task 3.)
- Tests: throwaway DB test for one-family enforcement (create → second create rejected; join while in a family rejected). Commit, push.

---

## Task 2 (branch `feat/family-02-premium-cascade`): whole-family premium

**Files:** `api/_lib/quota.ts` (`getOrgPlan` cascade, `checkFamilyMemberQuota`, `familyMembers` default), `api/_routes/billing/create-subscription.ts` + `billing/pricing.ts` (family `accountType` gating already present — verify), seed family plan rows (admin/seed), `src/components/OrgSwitcher.tsx` + plan badges ("Premium · via Family").

- `getOrgPlan(orgId)`: for a personal org, also resolve the owner's `family_org_id` → if that family has an active/trialing paid sub, use the better of (own, family) limits.
- `checkFamilyMemberQuota(familyOrgId)`: active members + pending invites < `limits.familyMembers` (free 2 / premium 8). Wire into join + members POST + family invite.
- Seed a `family` plan (`accountType='family'`, limits incl. `familyMembers`, geo pricing) following the existing plans seed/admin pattern.
- Tests: pure cascade resolution (better-of limits) in `quota`-adjacent pure helper or throwaway DB test. Commit, push.

---

## Task 3 (branch `feat/family-03-household`): shared wealth/spaces/stats + attribution API

**Files:** ensure spaces work for family (gating from Task 0), `api/_routes/family/contributions.ts` (GET by-member attribution), reuse dashboard/analytics/calendar/flow (org-scoped — verify they render for a family org), `src/lib/family.ts` attribution math (tests).

- GET `/api/family/contributions`: family-org legs `family_transfer=true` grouped by `family_party_user_id` and `type` (in=contribution, out=disbursement); per-member totals + timeline.
- Verify household pages (Dashboard/Wealth/Spaces/Budgets/Calendar/Flow/Analytics) render correctly with a family active org; fix any `is_personal`/account-type assumptions. Commit, push.

---

## Task 4 (branch `feat/family-04-transfer`): cross-org contribute / withdraw / disburse

**Files:** `api/_routes/family/transfer.ts` (POST + DELETE), `src/lib/wealth-ledger.ts` (cross-org sibling reversal), `api/index.ts`, personal-workspace "Contribute" entry points (Task 5 wires UI; API here).

- POST `/api/family/transfer` `{direction: contribute|withdraw|disburse, from_account_id?, to_account_id?, to_member_id?, amount, dest_amount?, date?, note?}`.
  - `contribute`: validate caller owns source (caller's personal org) + caller ∈ family; outgoing leg in personal, incoming leg in family; both `family_transfer=true`, `family_party_user_id=caller`; update both balances; shared `group_id`.
  - `withdraw`: family → caller's own personal account (caller owns dest).
  - `disburse`: head-only; family → recipient member's **default personal account** (ensure it exists; never read recipient's other accounts); `family_party_user_id=recipient`.
  - Cross-currency: if source/dest org currencies differ, require `dest_amount`; each leg records its own currency amount.
- DELETE `/api/family/transfer?group_id=`: reverse **both** legs across both orgs (find siblings by `group_id`); permission = contributor (own) or head; guard the generic `transactions/[id]` DELETE to 409 for `family_transfer` legs.
- Tests: throwaway DB — contribute moves both balances; delete reverses both; disburse lands in recipient default; privacy (caller can't target another member's specific account). Commit, push.

---

## Task 5 (branch `feat/family-05-hub-nav`): `/family` hub UI + nav + motion

**Sub-skills:** `ui-ux-pro-max` (design the hub), `transition-creator`/motion (seamless transitions), Playwright verify.

**Files:** `src/pages/FamilyPage.tsx`, `src/components/family/*` (Header, SharedBalances, ContributionsByMember, MembersPanel, ContributeModal, DisburseModal), `src/App.tsx` (`/family` route + `FamilyOnlyRoute`), `AppLayout.tsx`/`MobileAppLayout.tsx` (nav + FAB), `OrgSwitcher.tsx` ("Start/Join a family"), `data-events.ts` (`/api/family` in `WEALTH_AFFECTING`).

- Mobile-first hub; optimistic in-place updates (no full-screen reloads); contribute/disburse drawers; member management for head.
- Personal workspace "Contribute to your family" entry (dashboard + wealth) when `family_org_id` set.
- Verify in a real browser (Playwright/Chrome DevTools) that motion is seamless. Commit, push.

---

## Task 6 (branch `feat/family-06-onboarding`): onboarding family path

**Files:** `OnboardingPage.tsx` (third ChoiceCard), `src/components/onboarding/accents.ts` (family accent), create/join sub-step components, `OrgSetupPage.tsx`, `api/_routes/onboarding.ts` (handle `account_type:'family'` create + join).

- Selecting Family → Create (head: name+currency) or Join (invite/code); ensure personal org exists; land in family. MoneyWizard scoped to household; PlanStep family plan. Commit, push.

---

## Task 7 (branch `feat/family-07-landing`): landing + pricing + FAQ

**Sub-skill:** `ui-ux-pro-max`.

**Files:** `src/landing/sections/` (new segmentation pillar + Family section), `Pricing.tsx` (family plan card), `FAQ.tsx` (privacy/who-pays/leaving), landing i18n.

- "Personal · Business · Family" pillar; dedicated family section (shared household, family spaces, private personal accounts, contribute, whole-family premium). Commit, push.

---

## Task 8 (branch `feat/family-08-i18n`): family namespace across 8 locales

**Files:** `src/lib/i18n/index.ts` (`family` in `PAGE_NAMESPACES`), all 8 `locales/*.json` (`family` object + onboarding/landing keys). Use `scripts/i18n-merge.mjs` for bulk backfill; `npm run i18n:check` green. Commit, push.

---

## Task 9 (branch `feat/family-09-worker-e2e`): worker + Playwright + final gate

**Files:** `worker/` (scheduled allowances, auto-contributions, family digests via trigger callback — never a correctness dependency), `e2e/family.spec.ts` (create→join→contribute→attribution→disburse→privacy check), final review with `code-review`.

- Worker jobs advance due cross-org family transfers and send digests; documented as enhancement.
- Playwright smoke green on dev Clerk (424242). Commit, push, open PR stack.

---

## Self-review (against spec)

- **Spec coverage:** money model→T3/T4; subscription cascade→T2; roles→T0/T1; bidirectional transfer→T4; one-family→T0/T1; spaces for family→T0/T3; household stats→T3; onboarding→T6; landing→T7; nav/hub→T5; i18n→T8; worker→T9; privacy/balance integrity→T0/T4. No gaps.
- **Placeholders:** later branches are roadmap-level by design (detailed JIT before build); T0 is full-detail. Each branch lists exact files + tests + commit.
- **Type consistency:** `AccountType` family, `accountTypeAllows(_, 'family')`, `family_org_id`, `family_transfer`, `family_party_user_id`, `getOrgPlan` cascade, `checkFamilyMemberQuota`, `/api/family/transfer` direction enum — used consistently across tasks.
