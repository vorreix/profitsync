# Family Accounts — Design Spec

- **Date:** 2026-06-15
- **Status:** Approved (owner delegated all remaining decisions; author self-reviewed in lieu of a second reviewer)
- **Branch base:** `feature/family_1_maqbool`
- **Author:** Claude (autonomous build)

---

## 1. Summary

Add a third tenancy type — **Family** — alongside the existing **Personal** and **Business** account types.

A Family is a **shared household workspace** that *links* members who each keep a **fully private personal account**. Members switch into the Family workspace to manage shared money (joint accounts, family spaces, shared expenses, household stats); their personal accounts live in their own personal orgs that no other member belongs to, so **personal accounts are never shared — enforced by org-scoping, not by a flag.**

The single new money mechanic is a **cross-org "contribute / disburse" transfer**: money can move between a member's *private personal account* and the *shared family household* (both directions). Everything else reuses the existing organization, membership, invitation, subscription, wealth, spaces, and transfer infrastructure.

### Locked product decisions

| Decision | Choice |
|---|---|
| Money model | **Real shared balances + contribution attribution.** Household has its own joint accounts & spaces with real balances; contributing moves real money and records who contributed. |
| Subscription | **Whole-family premium.** One family subscription (paid by the head) lifts the shared household AND every member's personal account to premium limits. |
| Member roles (v1) | **Head + equal members.** Head manages members + billing + disbursements; members all contribute and manage the shared household. (`viewer` role reserved for a future view-only/kid tier.) |
| Transfer direction | **Bidirectional.** Member contributes personal→family; member self-withdraws family→own-personal; head disburses family→member. |
| Free member cap | **2** (head + 1). Premium: **8**. (Tunable via `plans.limits.familyMembers`.) |
| Worker | Enhancement only — feature works without it. |

## 2. Goals / Non-goals

**Goals**
- A user can create a family (becoming **head**) or join one via invite; **one family per user, ever** (hard invariant).
- A shared **household**: joint bank/cash accounts, **family spaces** (savings goals), shared expenses, and household stats — visible to all members.
- Members **contribute** money from their private personal accounts into the household; head can **disburse** to members; members can **withdraw** their own money back. All attributed (who put in / took out what).
- **No member ever sees another member's personal accounts/transactions/balances.**
- The head pays one subscription that makes the **whole family** premium (household + every member's personal account).
- First-class presence in **onboarding** and on the **landing page**.

**Non-goals (v1)**
- Splitwise-style settle-up / IOU ledgers (we do real shared balances + attribution instead).
- Per-member spending limits, approval workflows, kid/teen view-only mode (role is reserved, UI deferred).
- Automatic FX conversion on cross-currency contributions (we capture both amounts explicitly; no rate lookup).
- Merging two existing families; transferring a family between heads beyond the existing owner-transfer flow.

## 3. Architecture (Approach A)

**Family = a shared "household" org (`account_type='family'`, `is_personal=false`) + each member's private personal org + a cross-org transfer.**

Rejected alternatives:
- **B (pure linking layer / virtual aggregation):** no natural home for shared accounts/spaces/expenses; forks scoping, invites, billing.
- **C (everyone shares everything like a business team):** violates the hard "personal accounts never shared" rule.

Why A: a business org shares *all* data; a family needs *shared household* **plus** *private personal accounts*. Approach A gives both — the family org is the shared part (every member is a member), and each personal org has exactly one member (its owner), so cross-member personal visibility is impossible by construction. It reuses org membership, roles, invitations, the org switcher, per-org subscriptions, wealth accounts, spaces, and the two-leg transfer model.

## 4. Data model

### 4.1 Schema changes (migration `0046` — verify head/`_journal.json` `when` ordering per the drizzle timestamp gotcha)

```ts
// organizations.account_type: now 'personal' | 'business' | 'family' (text, unchanged column)

// user_profiles — single source of truth for "which family am I in" (one row per user ⇒ one-family-per-user is structural)
familyOrgId: uuid("family_org_id").references(() => organizations.id, { onDelete: "set null" }), // null = no family

// transactions — mark cross-org family flows
familyTransfer: boolean("family_transfer").notNull().default(false),       // a contribution/disbursement leg
familyPartyUserId: text("family_party_user_id"),                            // member the flow is attributed to (contributor in / beneficiary out)

// plans.limits jsonb — add: familyMembers?: number
```

No new membership table — **family membership reuses `organization_members`** (full reuse of invite/switch/auth/role). `user_profiles.family_org_id` is the denormalized pointer + uniqueness guarantee, kept in sync in every create/join/leave/remove path.

### 4.2 Role mapping (no new permission engine)

| Family role | `organization_members.role` | `canWrite` | `canDelete` | Billing |
|---|---|---|---|---|
| **Head** | `owner` | ✅ | ✅ | ✅ (owner-only, existing) |
| **Member** | `editor` | ✅ | ❌ | ❌ |
| *View-only (future)* | `viewer` | ❌ | ❌ | ❌ |

`canWrite('editor')` and `canDelete`/owner-only billing already encode "members contribute, only the head manages members/billing/deletion." `admin` is unused for families in v1.

### 4.3 Type changes (`src/lib/types.ts`)

- `AccountType = "personal" | "business" | "family"`; add to `ACCOUNT_TYPES`.
- `accountTypeAllows(accountType, feature)` update:
  - `clients`, `quotations` → business only (unchanged).
  - `members` → business **or family** (a family must manage members).
  - `spaces` → personal **or family** (families have shared spaces).
  - new `family` feature gate → `account_type === 'family'` only (gates the `/family` hub).
- `Organization` already carries `account_type`, `plan_key`, `plan_status` — no shape change.

## 5. One-family-per-user invariant

Enforced at three write paths **and** structurally:
1. **Structural:** `user_profiles.family_org_id` (one profile row per user) — a user can point at exactly one family.
2. **Create family:** reject if `family_org_id` already set.
3. **Join / accept invite:** reject if `family_org_id` already set (clear, friendly error).
4. **Admin add member:** same guard.
5. **Leave / remove / family delete:** clears `family_org_id`. Head cannot leave without transferring head (reuse last-owner guard) or deleting the family.

## 6. Whole-family premium (cascade)

The head's subscription lives on the **family org** (existing per-org model; `create-subscription` already owner-only). New behavior in `api/_lib/quota.ts#getOrgPlan`:

- For a **personal** org: in addition to its own subscription, check whether the owner's `family_org_id` points at a family with an **active/trialing paid** subscription. If so, the personal org inherits the **better** of (own limits, family limits).
- For the **family** org: its own subscription drives household limits.

UI: a member's personal account shows a `Premium · via Family` badge; the family workspace shows the plan normally. Cascade is read at quota-check time (no stored denormalization to drift). Cache: the auth/quota LRU already has a 60s TTL; cascade lookups ride existing query paths.

Limits (seeded in `plans`, tunable):

| Limit | Free family | Premium family | Cascaded to member personal (premium) |
|---|---|---|---|
| `familyMembers` | 2 | 8 | — |
| `bankAccounts` (shared) | 1 | 20 | personal banks → 20 |
| `spaces` (shared) | 1 | 7 | personal spaces → 7 |
| clients/quotations | n/a (family hides them) | n/a | unchanged for personal |

## 7. Cross-org contribute / disburse (the new mechanic)

Generalizes the existing two-leg transfer (`kind='transfer'`, shared `group_id`) to span two orgs. Both legs `kind='transfer'` ⇒ excluded from P&L on both sides (a contribution is neither household "income" nor member "expense" — it's a transfer, like funding a space).

### Endpoints

`POST /api/family/transfer` with `direction`:
- `contribute` — member's personal account → family account/space.
- `withdraw` — family account → member's **own** personal account (member self-service).
- `disburse` — family account → a **member** (head only). Recipient is chosen by *member*, not account; money lands in the recipient's **default personal account** (head never reads recipient accounts → privacy preserved).

### Mechanics (contribute example: personal P → family F)

1. Validate: caller owns source account (it belongs to caller's personal org) AND caller ∈ family F.
2. `groupId = randomUUID()`.
3. Outgoing leg in **P**: `wealthAccountId=personal source`, `clientId=P default client`, `kind='transfer'`, `type='outgoing'`, `familyTransfer=true`, `familyPartyUserId=caller`, `createdBy=caller`.
4. Incoming leg in **F**: `wealthAccountId=family dest`, `clientId=F default client`, `kind='transfer'`, `type='incoming'`, `familyTransfer=true`, `familyPartyUserId=caller`, `createdBy=caller`.
5. Update balances: P source `-= amount`, F dest `+= amount` (direct SQL, the existing pattern).
6. Both legs share `groupId` (they're in different orgs via different `client_id` ⇒ different `organization_id`).

`disburse` mirrors this with the head as `createdBy` and `familyPartyUserId=recipient member`; the F leg is outgoing, the recipient's personal-default leg is incoming.

### Attribution views (data already present)

- **Family Contributions:** family-org legs where `familyTransfer=true AND type='incoming'`, grouped by `familyPartyUserId` (= contributor). Sum per member, timeline.
- **Family Disbursements:** family-org legs where `familyTransfer=true AND type='outgoing'`, by `familyPartyUserId` (= beneficiary).
- **Member personal wealth:** their `familyTransfer=true` legs labelled "To/From [Family name]" (family name resolved via `family_org_id`).

`familyTransfer` distinguishes cross-org family flows from internal household transfers (household bank → household space, which stay `familyTransfer=false`).

### Privacy

The family-org leg stores only `familyPartyUserId` (a Clerk user id rendered as the member's already-known display name) — **never** the personal account id or balance. The personal-org leg is in the member's own private org. No leakage path.

### Balance integrity (critical)

- Delete/restore of a family transfer reverses **both** legs across **both** orgs (siblings found by `group_id`, balances reversed on both accounts) — extends `src/lib/wealth-ledger.ts` reversal to cross-org siblings.
- A `familyTransfer` leg is **not independently deletable** via the normal transaction delete; it must go through `DELETE /api/family/transfer` (guard returns 409 otherwise) so balances can never drift. Honors the standing rule: *DB-direct tx delete does not reverse wealth balances*.
- Permissions on delete: contributor (own contribution) or head.

### Currency

Same currency (the common case — one family currency) is the clean path: one `amount`, both legs equal. If personal and family currencies differ, the modal captures **both** amounts explicitly (source amount parted with + destination amount received); each leg records its own org-currency amount. No rate lookup, no silent FX. Each leg is a transfer (excluded from P&L), so unequal cross-currency amounts are correct.

## 8. Wealth / spaces / household

The **family org IS the household**:
- Its `wealth_accounts` (bank/cash) = shared household accounts (joint account, household cash). Cash auto-provisioned as today.
- Its `wealth_accounts` type=`space` = **family spaces** (vacation, emergency fund). Spaces enabled for `family` via `accountTypeAllows`.
- Its transactions/budgets/calendar/flow/analytics = household money — all reuse existing org-scoped pages.
- Net worth in the family workspace = household net worth (existing computation, org-scoped).

Auto-save into family spaces and scheduled allowances reuse `recurring_rules` (`kind='transfer'`, now cross-org capable for allowances) — lazy materialization, no cron required for correctness.

## 9. Quotas

- `checkFamilyMemberQuota(familyOrgId)` — blocks invite/accept beyond `limits.familyMembers`; counts active members + pending invites.
- Family contributions/disbursements are transfers → **not** counted against per-client transaction quota (core to the feature; mirrors space-transfer exemption).
- Shared bank/space quotas use the family org's (possibly premium) plan.

## 10. Onboarding

Add a third `ChoiceCard` **Family** (accent: e.g. `rose`/`amber`, `Users`/`HeartHandshake` icon) to the type step.

- **Create a family** (head): family name + currency → create family org (`account_type='family'`), caller = `owner`, set `user_profiles.family_org_id`; personal org still auto-exists (private). MoneyWizard scoped to the household (shared cash/bank/space). PlanStep shows family plan. Active workspace → the family.
- **Join a family**: enter invite code / open invite link → reuse the invitation flow, with the one-family guard. Stamps `onboarded_at`, lands in the family.

Existing users (already onboarded) can create/join later from the **OrgSwitcher** ("Start a family" / "Join a family") and a `/family` empty state.

## 11. Landing page & pricing

- New **"Personal · Business · Family"** segmentation pillar.
- A dedicated **Family section**: shared household, family spaces, *private* personal accounts, contribute mechanic, whole-family premium.
- **Family plan** added to the pricing section (and `/api/public/pricing` via `accountType` filtering already supports it).
- FAQ entries (privacy of personal accounts, who pays, leaving a family).
- Optional: a dedicated SSR'd `/family` marketing route (v1.1 — section in the main landing first).

## 12. App shell / routes / nav

- New route `/family` (lazy, inside `<AppLayout>`), gated by a new `<FamilyOnlyRoute feature="family">`.
- `buildNavItems` / `buildPrimaryTabs` / `buildMoreItems`: in a family workspace show Dashboard (household), Transactions, Wealth (shared), **Spaces**, **Family hub**, Members, Budgets, Calendar, Flow, Analytics, Subscription, Categories, Recurring, Trash; hide Clients/Quotations.
- **Personal workspace** gains a "Contribute to your family" entry (dashboard + wealth) when `family_org_id` is set, so members fund the household without switching.
- FAB in the family workspace: Add household transaction / Contribute / Add family space.
- `data-events.ts`: add `/api/family` to `WEALTH_AFFECTING` (family transfers move balances).

## 13. The `/family` hub (centerpiece, designed with `ui-ux-pro-max` + motion)

Sections: family header (name/photo, member avatars), **shared balances** (household accounts + family spaces), **Contributions by member** (who funded what, with sparkline), quick actions **Contribute / Disburse (head) / Add space**, **members** (head can invite/remove/transfer head), and an activity feed. Mobile-first, optimistic in-place updates, seamless transitions (no full-screen reloads).

## 14. Worker integration (enhancement)

The worker (self-hosted Go service) adds true scheduling — the feature is fully functional without it:
- **Scheduled allowances:** head→member recurring disbursements that fire on time even if no one opens the app (worker advances due cross-org family transfers via the trigger-style callback).
- **Auto-contributions:** member→family-space recurring transfers (also work via lazy materialization).
- **Family digests:** periodic household summary notifications (rides the existing notification scheduler).

Built last; never a correctness dependency.

## 15. i18n

- New `family` namespace added to `PAGE_NAMESPACES` and all 8 locales (`en` is source of truth; `npm run i18n:check` must pass). Onboarding/landing strings added to `translation`.

## 16. Security & invariants (must hold)

1. **Personal privacy:** members are never members of each other's personal orgs ⇒ org-scoping prevents cross-visibility. Contribute/disburse validate source-ownership + family-membership; disbursements never read recipient accounts.
2. **One family per user:** structural (`user_profiles.family_org_id`) + guards at create/join/admin-add.
3. **Balance integrity:** cross-org transfers update both balances; delete/restore reverses both legs; family legs are not independently deletable.
4. **Owner-only billing & member management** (existing role helpers).
5. **Route guards:** all new `api/_routes/family/*` handlers call an auth guard (route-guard sweep in `security.yml`).
6. **ESM `.js` extensions** on all new relative imports in `api/` (prod-parity guard).
7. **Serialize** every row before `res.json`.

## 17. Edge cases

- Head leaves → must transfer head or delete family (last-owner guard).
- Family deleted → members' `family_org_id` cleared; shared household data removed (cascade); members keep their personal accounts untouched.
- Member removed → their past contributions remain in household history (attribution preserved by `familyPartyUserId`); pointer cleared.
- Premium lapses → cascade stops; members revert to their own personal plan limits (no data loss, standard over-limit read-only behavior).
- Cross-currency contribution → both amounts captured; no FX.
- Disburse to a member with no default personal account → ensure their personal default (Cash) exists first.

## 18. Build plan (stacked branches off `feature/family_1_maqbool`)

1. **family-00 foundation:** migration 0046, types (`AccountType`+family), `accountTypeAllows`, auth role mapping, one-family helpers. No UI.
2. **family-01 membership:** create/join/leave family, invitation extension + one-family guard, head transfer, `/api/family` hub data.
3. **family-02 premium cascade:** `getOrgPlan` cascade, `familyMembers` quota, family plan rows + seed, `create-subscription`/`pricing` family gating, "via Family" badges.
4. **family-03 household wealth/spaces:** enable spaces for family, household accounts, family stats reuse, contributions/disbursements aggregation API.
5. **family-04 cross-org transfer:** `POST/DELETE /api/family/transfer` (contribute/withdraw/disburse), two-leg cross-org, balance updates, reversal, guards; personal-workspace "Contribute" entry points.
6. **family-05 hub + nav:** `/family` page (`ui-ux-pro-max` + motion), nav/shell/FAB integration, feature gating, mobile layout.
7. **family-06 onboarding:** third ChoiceCard, create/join sub-flows, accents, MoneyWizard household, PlanStep family.
8. **family-07 landing + pricing:** segmentation pillar, family section, family plan in pricing, FAQ.
9. **family-08 i18n:** `family` namespace across 8 locales; `i18n:check` green.
10. **family-09 worker + e2e + gate:** worker allowances/auto-contrib/digests, Playwright smoke, full pre-commit gate, review.

Each branch ends green through the pre-commit gate (secret scan → esm-extensions → boot-functions → i18n:check → lint → typecheck → test:ci) and is pushed.

## 19. Testing

- Unit (`src/lib/*.test.ts`, DB-free): `accountTypeAllows` family cases; cross-org reversal math in `wealth-ledger`; cascade limit resolution; one-family guard logic (pure helpers).
- Throwaway DB tests (run + delete) for: contribute/withdraw/disburse balance correctness across two orgs; delete reversal; one-family enforcement.
- Playwright smoke (`e2e/`): create family → invite/join (dev Clerk 424242) → contribute → see attribution → disburse → privacy check (member B cannot see member A's personal accounts).

## 20. Future (v2+)

- View-only / kid role + per-member allowances/limits + head approval.
- Splitwise-style settle-up overlay on shared expenses.
- Cross-currency FX rates.
- Dedicated SSR `/family` marketing page.
- Family activity export / monthly statement.
