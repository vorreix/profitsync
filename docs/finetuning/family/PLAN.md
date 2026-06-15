# Family Accounts — Live Branch Tracker

Single source of truth for the Family epic. Detailed design: `docs/superpowers/specs/2026-06-15-family-accounts-design.md`. Step plan: `docs/superpowers/plans/2026-06-15-family-accounts.md`.

**What Family is:** a third tenancy type — a shared *household* org (`account_type='family'`) that links members who each keep a fully **private** personal account. Real shared balances + contribution attribution; whole-family premium; head + equal members; bidirectional cross-org transfers. Personal accounts are never shared (enforced by org-scoping). The only new money mechanic is a two-leg transfer that spans two orgs.

## Working conventions (every branch)

- Mobile-first (~390px first, ≥44px targets), seamless transitions (`transition-creator`), `prefers-reduced-motion` respected.
- **Instant in-place data updates** — never swap a list for a skeleton after a mutation; insert/replace/remove the affected row optimistically, silent refetch only on failure.
- i18n: English first, propagate to all 8 locales; `i18n:check` gates the commit.
- Scoping by `orgId`; `serialize()` every row; `.js` ESM extensions in `api/`; route auth guards; static-before-dynamic route registration.
- **Money path verified by hand + pure unit tests before changing code.** Cross-org transfers update both balances and reverse both legs together; family legs aren't independently deletable.
- **Prime directive:** no path exposes one member's personal accounts/transactions/balances to another.
- Each branch ends green through the full pre-commit gate (no `--no-verify`) and is pushed.

## Branch chain (stacked off `feature/family_1_maqbool`)

| # | Branch | Scope | Status |
|---|---|---|---|
| 00 | `feat/family-00-foundation` | account_type 'family'; `user_profiles.family_org_id`; `transactions.family_transfer`+`family_party_user_id`; migration 0046; `accountTypeAllows` family cases; `src/lib/family.ts` helpers+tests; `getUserFamilyOrgId` | ✅ done (gate green, migration applied + verified) |
| 01 | `feat/family-01-membership` | create/leave family; invitation+members one-family guard; `GET/POST/DELETE /api/family` | ✅ done (DB round-trip verified) |
| 02 | `feat/family-02-premium-cascade` | `getOrgPlan` whole-family premium cascade (maxByKey); `checkFamilyMemberQuota`; invite-path gating. NOTE: family plan ROW is an /admin/plans data task (no code seed) | ✅ done |
| 03 | `feat/family-03-household` | spaces enabled for family (canUseSpaces); `GET /api/family/contributions` attribution | ✅ done |
| 04 | `feat/family-04-transfer` | `POST/DELETE /api/family/transfer` (contribute/withdraw/disburse); cross-org two-leg + reversal; generic tx PATCH/DELETE 409-guarded | ✅ done (money path DB-verified: both balances move + reverse) |
| 05 | `feat/family-05-hub-nav` | `/family` hub UI + nav/FAB + `FamilyOnlyRoute`; OrgSwitcher start/join; personal "Contribute" entry; motion | ⏳ next (UI) |
| 06 | `feat/family-06-onboarding` | third ChoiceCard; create/join sub-flows; accents; MoneyWizard household; PlanStep family | pending |
| 07 | `feat/family-07-landing` | Personal·Business·Family pillar; family section; family plan card; FAQ | pending |
| 08 | `feat/family-08-i18n` | `family` namespace across 8 locales + onboarding/landing keys | pending |
| 09 | `feat/family-09-worker-e2e` | worker allowances/auto-contrib/digests (enhancement); Playwright e2e; final review | pending |

## Verified facts / corrections (auditable)

- ✅ `src/lib/wealth-ledger.ts` `reversalsByAccount`/`applicationsByAccount` are **account-keyed**, so they already handle a cross-org transfer's two legs unchanged — the reversal map is `{personalAcct:+amt, familyAcct:−amt}`. No money-path rewrite needed; reuse the proven helper.
- ✅ `createOrgForUser({accountType})` is typed `AccountType`; widening the union makes family-org creation work with no signature change.
- ✅ Worker cron pattern exists (`requireServiceToken` + `POST /api/cron/*`) — the worker branch slots in without new auth plumbing.
- ✅ Migration 0046 `when`=1781487249586 > 0045's 1781470640739 (no silent-skip); columns confirmed in `information_schema`.
- Note: `requireBusinessFeature(...,'members')` denies personal accounts — family routes must NOT use it for member management (family allows members); gate on `accountTypeAllows(accountType,'members')` / explicit role checks instead.

## Status summary

**Backend complete (00–04).** A user can create a family, invite/join (one-family enforced), the household has shared accounts + family spaces, members contribute/withdraw and the head disburses across orgs with verified balance integrity, and a paid family lifts every member's personal account (cascade). All correctness paths gated + the money path DB-verified.

**Remaining = UI + i18n + worker (05–09):**
- 05 hub/nav: add `/family` route + `FamilyOnlyRoute`; `buildNavItems`/`buildPrimaryTabs`/`buildMoreItems` show Family hub + Spaces for family, hide Clients/Quotations; `FamilyPage` (members, shared balances, contributions-by-member, Contribute/Disburse drawers); OrgSwitcher "Start/Join a family"; personal-workspace "Contribute" entry; `/api/family` in `WEALTH_AFFECTING`. Client API helpers: GET `/api/family`, GET `/api/family/contributions`, POST/DELETE `/api/family/transfer`, POST `/api/family`. Data-shape types already in `src/lib/types.ts` (FamilyHub, FamilyMember, FamilyContributions).
- 06 onboarding: third ChoiceCard (accent already added in family-00) → create (POST /api/family) or join (invite link); MoneyWizard household; PlanStep family.
- 07 landing: Personal·Business·Family pillar + family section + family plan card + FAQ.
- 08 i18n: `family` namespace across 8 locales (en source) + onboarding/landing keys.
- 09 worker: scheduled allowances (head→member) + auto-contributions via recurring (cross-org); family digests; Playwright e2e; final review. NOTE: also create the `family` plan row in /admin/plans for paid family checkout.

## Change log

- 2026-06-15 — Spec + plan committed on `feature/family_1_maqbool`. **Backend 00–04 shipped + pushed** (each green through the full gate):
  - 00 foundation: types/schema/migration 0046/helpers; 10 unit tests; dev DB migrated + columns verified.
  - 01 membership: create/leave/hub + family-aware invitation accept + one-family guard; DB round-trip verified.
  - 02 cascade: whole-family premium via getOrgPlan + familyMembers quota; maxByKey unit-tested.
  - 03 household: Spaces enabled for family; contributions attribution API.
  - 04 transfer: cross-org contribute/withdraw/disburse + reversal; generic tx mutate guarded; **money path DB-verified** (balances move + reverse, ownership enforced).
