# ProfitSync — Complete Product Overview

> A plain-English + technical guide to everything ProfitSync does: who it's for,
> every feature, how each one works, and the flows that tie them together
> (sign-up, referrals, bank accounts, splitting transactions, transfers,
> subscriptions, and more).
>
> Audience: founders, team members, support, sales, and developers.
> Last reviewed against the codebase: 2026-06.

---

## Table of Contents

1. [What ProfitSync Is](#1-what-profitsync-is)
2. [Who It's For & Why It Helps](#2-who-its-for--why-it-helps)
3. [Core Concepts (the mental model)](#3-core-concepts-the-mental-model)
4. [Sign-up, Login & Onboarding Flow](#4-sign-up-login--onboarding-flow)
5. [Organizations & Teams (multi-tenancy)](#5-organizations--teams-multi-tenancy)
6. [Members, Roles & Invitations](#6-members-roles--invitations)
7. [Clients](#7-clients)
8. [Transactions (Income & Expenses)](#8-transactions-income--expenses)
9. [Wealth & Bank Accounts](#9-wealth--bank-accounts)
10. [The Split Feature (splitting a transaction across accounts)](#10-the-split-feature)
11. [Transfers Between Accounts](#11-transfers-between-accounts)
12. [Quotations (sales pipeline)](#12-quotations-sales-pipeline)
13. [Dashboard & Analytics](#13-dashboard--analytics)
14. [Categories, Search & Filtering](#14-categories-search--filtering)
15. [Attachments (files & receipts)](#15-attachments-files--receipts)
16. [Trash & Soft-Delete (recovery)](#16-trash--soft-delete-recovery)
17. [Profile & Settings](#17-profile--settings)
18. [Currency & Multi-Currency](#18-currency--multi-currency)
19. [Subscriptions & Billing (Dodo Payments)](#19-subscriptions--billing-dodo-payments)
20. [Plans & Quotas (Free vs Premium)](#20-plans--quotas-free-vs-premium)
21. [Referral Program (earn rewards)](#21-referral-program-earn-rewards)
22. [Admin Console](#22-admin-console)
23. [Internationalization (8 languages + RTL)](#23-internationalization-8-languages--rtl)
24. [Marketing Site, Blog & SEO/GEO](#24-marketing-site-blog--seogeo)
25. [Mobile App & PWA](#25-mobile-app--pwa)
26. [Architecture at a Glance (for developers)](#26-architecture-at-a-glance-for-developers)
27. [Feature Availability Matrix](#27-feature-availability-matrix)

---

## 1. What ProfitSync Is

**ProfitSync is a business finance management app that tells you how much you
earn, spend, and *actually profit* — broken down per client and per account.**

Instead of a generic accounting ledger, ProfitSync is organized around the
relationships and money pools a small business or freelancer cares about:

- **Clients** — who you make (or lose) money with.
- **Transactions** — every payment in and every expense out.
- **Wealth accounts** — the real bank and cash accounts the money lives in.
- **Quotations** — the deals you're trying to win, that convert into clients.
- **Dashboard & Analytics** — the profit picture across all of the above.

The design direction is deliberately **modern, clean, simple, and
professional** — it's a tool a non-accountant can open and understand in
seconds, on desktop or phone.

---

## 2. Who It's For & Why It Helps

### Who

- **Freelancers & solo operators** who need to know which clients are worth it.
- **Agencies & small businesses** that bill multiple clients and want
  per-client profit margins.
- **Teams** that need shared books with role-based access.
- **Globally operating businesses** — multi-currency, 8 languages, and a
  Merchant-of-Record payment provider that localizes price + tax automatically.
- **Personal finance users** — a lightweight "Personal" account mode for
  tracking your own money without the client/quotation machinery.

### Why it helps

| Pain | How ProfitSync solves it |
|---|---|
| "I don't know which clients are actually profitable." | Per-client income, expense, and **net profit / margin %** on every client card and detail page. |
| "My money is spread across cash + several bank accounts." | **Wealth accounts** track each balance; every transaction syncs the right account automatically. |
| "One payment came from two accounts / I paid a bill partly cash, partly card." | **Split transactions** — one logical entry allocated across multiple accounts. |
| "I lost a record by accident." | **Soft-delete + Trash** — restore anything; nothing is gone until you purge it. |
| "I work with clients abroad." | **Per-org currency**, 8 UI languages, RTL Arabic, localized checkout. |
| "I need my team in here." | **Organizations** with owner/admin/editor/viewer roles and email invitations. |
| "I want to grow the tool and get rewarded." | **Referral program** with real cash payouts (UPI / PayPal / bank). |

---

## 3. Core Concepts (the mental model)

| Concept | What it is |
|---|---|
| **Organization (workspace)** | The top-level container. Every client, transaction, quotation, and account belongs to an org — never directly to a user. Each user gets a **personal org** automatically; they can also create **business orgs** for teams. |
| **Client** | A business relationship you track. Holds its own transactions, quotations, notes, files, status, and profit/loss. |
| **Transaction** | Money **incoming** (income) or **outgoing** (expense), recorded under a client and tied to one or more wealth accounts. |
| **Wealth account** | A real money pool — a **bank** account or **cash in hand**. Holds a running balance that the app keeps in sync. |
| **Leg / Group** | A single transaction can be **split** across accounts. Each account's portion is a **leg**; legs that belong together share a **group_id**. |
| **Quotation** | A priced proposal to a prospect. Has a status pipeline and can be **converted into a client** when won. |
| **Category** | A custom, per-org label used to organize and filter transactions. |
| **Plan** | `free` or `premium`. Determines quotas (how many clients, transactions, file sizes, etc.). |
| **Subscription / Invoice** | The billing records that mirror the payment provider (Dodo). |

**Golden rule (technical):** all data is scoped by **organization**, not by user.
Switching orgs switches the entire data view.

---

## 4. Sign-up, Login & Onboarding Flow

Authentication is handled by **Clerk** (a managed auth provider). ProfitSync
never stores raw passwords.

### Available auth flows

- **Sign up** — create an account (email/password; social login on mobile).
- **Login** — standard sign-in.
- **Forgot password** — request a reset email.
- **Reset password** — set a new password from the emailed link.
- **Email verification** — Clerk verifies the email before the account is live.

### Step-by-step: first-time sign-up

1. A visitor opens `/signup` (or clicks "Get started" from the marketing site).
2. Clerk collects email + password and verifies the email.
3. On first authenticated load, the app calls **`GET /api/profile`**.
   - If no profile exists, the backend **creates one** (name + email from Clerk).
   - If the sign-up link carried a **referral code** (`/?r=CODE`), the code was
     stored in Clerk metadata and is now attributed to the referrer
     (see [Referrals](#21-referral-program-earn-rewards)).
   - The backend calls `ensurePersonalOrg()` to create a **personal
     organization** with a **free** subscription and a default internal client,
     and sets it as the user's current org.
4. If the user hasn't chosen an account type yet (`onboarded_at` is null), they
   land on **Onboarding** and pick **Personal** or **Business**.
   - **Personal** hides team features (clients-as-customers, quotations,
     members) and presents a lightweight money tracker.
   - **Business** unlocks the full client / quotation / team toolset.
5. After onboarding, the user lands on **`/dashboard`**, ready to use
   immediately — no manual setup required.

### Subsequent logins

- Clerk validates the session; the app loads the **profile + org list** in
  parallel and restores the **last-active org** (resolved from the `x-org-id`
  header → profile's `current_organization_id` → personal org).

**Why this matters:** a new user is productive in seconds. The personal org,
free plan, and default account already exist before they click anything.

---

## 5. Organizations & Teams (multi-tenancy)

Organizations (a.k.a. **workspaces**) are the central multi-tenancy unit.

### Personal vs Business orgs

| | **Personal org** | **Business org** |
|---|---|---|
| Created | Automatically on sign-up | Manually, anytime |
| Members | Just you | You + invited team |
| Clients as customers | Hidden / gated | Full client CRM |
| Quotations | Hidden / gated | Full pipeline |
| Use case | Track your own money | Run a business / agency |

A user can belong to **many** orgs and switch between them freely.

### Creating an organization

1. Open the **Org Switcher** in the sidebar header → "Create Organization".
2. Enter a **name** and **currency**.
3. The backend generates a unique slug, creates the org with you as **owner**,
   ensures a **free** subscription and a default internal client.
4. The new org appears instantly and you can switch into it.

### Switching organizations

- The Org Switcher lists every org you're a member of.
- Selecting one updates the active org (sets the `x-org-id` header + persists
  `current_organization_id`) and reloads the dashboard scoped to that org.
- An in-memory membership cache (60s TTL) keeps switching fast.

**Why it matters:** complete data isolation per workspace — a US org in USD and
an India org in INR live side by side, with separate clients, books, and plans.

---

## 6. Members, Roles & Invitations

Business orgs support **role-based access control**.

### Roles & permissions

| Role | Can do |
|---|---|
| **Owner** | Everything: invite/remove members, change roles, manage billing, transfer ownership, delete the org. |
| **Admin** | Invite/revoke members, remove non-owners, create/edit/delete data. Cannot change roles. |
| **Editor** | Create and edit data (clients, transactions, quotations). Cannot manage members. |
| **Viewer** | Read-only access. |

Backend permission helpers enforce this on every write:
- `canWrite(role)` → owner, admin, or editor.
- `canDelete(role)` → owner or admin.

### Invitation flow

1. An owner/admin invites a teammate by email from **Members** (`/organizations/:id/members`).
2. The system creates an **invitation** with a unique **token** and an
   **expiry** date.
3. The invitee receives a link → `/invitations/:token`.
4. They sign in (or sign up inline) and accept; on acceptance they become a
   **member** with the assigned role.
5. Owners/admins can **revoke** pending invitations before they're used; expired
   tokens are rejected.

**Why it matters:** delegate work without handing over the keys — a bookkeeper
can be an editor, a stakeholder a viewer, a co-founder an admin.

---

## 7. Clients

Clients are the heart of the app — every transaction and quotation hangs off a
client.

### Client fields

`name` (required), `company`, `email`, `phone`, `status`
(`active | inactive | archived`), `category` (custom tag), `notes`,
`onboard_date`, plus computed `total_incoming`, `total_outgoing`, and
`attachment_count`. A special **internal/own client** (`is_own`) exists per org
and can't be deleted — it anchors transactions that aren't tied to a customer.

### Client list (`/clients`)

- Responsive **card grid** (or list). Each card surfaces, at a glance:
  - **Total income** (green), **Total expenses** (red), **Profit / loss**.
- **Search** by name, company, or email.
- **Sort** by name or date created; the internal client is pinned first.
- **Status badges** are color-coded; archived/closed clients appear in a
  separate section.
- **Multi-select bulk delete** (long-press or checkboxes) moves clients **and
  their transactions** to Trash. The internal client is never selectable.
- **Pagination** ("Load more", 20 per page).

### Client detail page (`/clients/:id`)

A full drill-in for one relationship:

- **Header** — name, status, company, contact, onboard date, notes.
- **Financial summary** — Total Income, Total Expenses, **Net Profit**, and
  **margin %**.
- **Transactions section** — tabs (All / Income / Expenses), search, sort
  (newest/oldest/amount), date-range filter, per-transaction edit/delete, and an
  **Add Transaction** action.
- **Files** — attachments for the client.
- **Close / reopen** — archive a finished relationship (hidden from default
  lists and analytics) without deleting its history; reopen anytime.

**Why it matters:** you stop guessing. Each client shows its true contribution
to your bottom line.

---

## 8. Transactions (Income & Expenses)

Transactions are the atomic financial events.

### Fields

`type` (`incoming | outgoing`), `amount`, `description`, `category`, `date`,
`client_id`, `wealth_account_id`, `group_id` (set when split), `kind`
(`standard` or `transfer`), `is_system` (auto-generated entries), plus
`attachment_count` and `deleted_at` (soft-delete).

### What you can do

- **Add** income or expense, choosing the client, account(s), amount, category,
  date, description, and optional file attachments.
- **Edit** any field. Changing the account reverses the old account's balance
  and applies it to the new one.
- **Delete** — soft-deletes to Trash and immediately reverses the balance effect.
- **Bulk-delete** multiple transactions at once.
- **Search & filter** — full-text on description/category, income/expense tabs
  with live counts, date ranges, category multi-select, and client filter.

### Transactions page (`/transactions`)

- **Grouped view (default):** split transactions collapse into one summary row
  showing the combined amount and an "N accounts" hint.
- **Detail modal:** large color-coded amount, date, category, description, the
  **split breakdown** (each leg + its account), attachments, and an **audit
  history** (who changed what, when).

### How a transaction moves money

Every transaction updates the linked **wealth account** balance:
- `incoming` → balance **+= amount**
- `outgoing` → balance **−= amount**
- Delete reverses it; restore re-applies it. (See [Wealth](#9-wealth--bank-accounts).)

**Why it matters:** your account balances are always live and correct, and every
entry carries its own paper trail (attachments + audit log).

---

## 9. Wealth & Bank Accounts

**Wealth** is ProfitSync's money-pool tracker — the real accounts your cash
actually sits in. Every transaction is anchored to one or more wealth accounts,
and balances stay in sync automatically.

### Account types

| Type | Description |
|---|---|
| **Cash in Hand** (`cash`) | The default account every workspace gets automatically. Mandatory — can be renamed/re-iconed but **never deleted or archived**. Always listed first. |
| **Bank** (`bank`) | Any bank / current / savings / deposit account. Can be archived (but not hard-deleted once it has transactions). |

### How to add a bank account

**Wealth page → "Add Bank"** opens a form (bottom sheet on mobile, modal on
desktop):

- **Bank name** (with live autocomplete + automatic **logo lookup**; both a URL
  and a base64 backup of the logo are stored for resilience).
- **Nickname** (optional, e.g. "Main Current Account", "USD Account").
- **Icon** (visual identifier).
- **Opening balance** (optional — recorded as a system "Opening Balance" entry).
- **Optional bank details** (stored for reference, not used in math):
  country (ISO code — relabels the next fields per locale), account number /
  IBAN, routing / sort / IFSC / BSB / transit number, SWIFT/BIC, branch
  location, address, and an internal note.

You can hold up to **5 bank accounts per organization** (plus the mandatory Cash
in Hand). Cards can be **drag-reordered** via a grip handle.

### How balances are tracked — the ledger model

Balances are **stored**, not recomputed on every page load. Each account keeps
`opening_balance` and `current_balance`:

```
opening_balance = 500
+ incoming 100  → current_balance = 600
- outgoing  50  → current_balance = 550
delete that outgoing → current_balance = 600   (reversed exactly)
```

This is **money-critical** code: the add/subtract direction is centralized in
`src/lib/wealth-ledger.ts` (`balanceDelta`, `reverseDelta`,
`reversalsByAccount`, `applicationsByAccount`) and covered by unit tests, so a
soft-delete + restore returns the balance to *exactly* where it was.

### Other account actions

- **Balance adjustment** — manually correct a balance; the app records the
  difference as a hidden system transaction ("Balance Adjustment").
- **Archive / restore** — hide an old account without losing history; restore
  anytime.
- **Delete** — only if the account has **no** transactions (otherwise it
  auto-archives to protect history). Owners/admins only.
- **Privacy toggle** — an eye icon hides all balances (shows `•••`); the choice
  persists locally.

### Account detail page

Shows the account's balance, its own transaction ledger, and a **quick-add
sheet** for recording a transaction directly against that account.

**Why it matters:** you always know how much real money is where — across cash
and every bank — without exporting anything.

---

## 10. The Split Feature

> **In one line:** a *split* records **one logical transaction paid from (or
> received into) multiple accounts at once**, instead of forcing you to enter
> several separate transactions.

### What it's for

Real money rarely moves cleanly from a single account:

- **Shared payment:** pay a supplier $100 — $30 from cash, $70 from the business
  account.
- **Multi-account receipt:** a client payment that lands partly in one bank,
  partly in another.
- **Allocation:** distribute a single expense or income across pools in one
  entry.

A split keeps it as **one transaction** (same date, category, description,
client) while each account's portion updates that account's balance
independently.

### How to create a split

1. Open the **New Transaction** form (from an account, a client, or the global
   Add action).
2. Enter the type (incoming/outgoing) and the details (client, category, date,
   description).
3. In the **Account Selector**, toggle **Split** (split icon).
4. Tick each account you want to use and enter that account's amount.
5. The summary bar shows **"Split across N accounts"** and a running total.
6. Save.

```
Total: $100  (incoming, client = ACME, category = "Office Supplies")
  ☑ Cash in Hand   $30
  ☑ Bank Account 1 $25
  ☑ Bank Account 2 $45
  ── total $100 ✓ → creates 3 legs sharing one group_id
```

### How it works under the hood — legs & groups

- Each account's portion is a **leg** (one row in `transactions`).
- Legs that belong to the same split share a **`group_id`** (a single-account
  transaction has `group_id = null`).
- All legs in a group share `client_id`, `type`, `description`, `category`,
  `date`, and `is_system`; each leg has its own `wealth_account_id` and `amount`.
- API: **`POST /api/transactions/group`** takes an `allocations` array and
  returns the `group_id` + the created legs. It validates the accounts, checks
  quota, generates a `group_id` only when there are 2+ legs, inserts each leg,
  and updates every affected account's balance atomically.

### Integrity rules

- **Deleting a split deletes all its legs together** — `resolveTxLegs()`
  expands any selected leg to its whole group so no orphan legs are left behind
  and the stored balance is fully reversed.
- **Display:** in lists a split collapses into one row with `leg_count` and
  `account_count`; the detail view shows every leg with its account.
- **Quota:** on the free plan a split counts as **multiple** transactions toward
  the per-client limit (a 3-way split = 3), so it can't be used to dodge quotas.

**Why it matters:** your books match reality even when a single payment touches
several accounts — without cluttering the ledger with disconnected entries.

---

## 11. Transfers Between Accounts

A **transfer** moves money from one of your accounts to another (e.g. "move $500
from Checking to Savings"). It's your own money changing pools — not income or
expense.

### How to transfer

**Wealth page → "Transfer"** (appears once you have 2+ accounts) opens a 2-step
wizard:

1. **Amount** — pick **From** and **To** accounts (the same account is
   auto-disabled on the other side), enter the amount. An "insufficient funds"
   note appears if it exceeds the source balance (it doesn't block you).
2. **Details** — optional date, optional note, optional file attachments → 
   **Transfer Now**.

You can also start a transfer by **dragging one account card onto another** on
the Wealth page (drop on the center to transfer; drop on an edge to reorder).

### How it works under the hood

`POST /api/wealth/transfer` creates **two linked legs** sharing a `group_id`,
both `kind: "transfer"`:

- **Outgoing leg** on the source ("Transfer to {destination}") → source balance
  **−= amount**.
- **Incoming leg** on the destination ("Transfer from {source}") → destination
  balance **+= amount**.

Both are anchored to the org's internal client and are **excluded** from income/
expense totals, the global transactions list, and analytics (they net to zero —
they're not profit or loss). They appear only on each account's own ledger.

**Why it matters:** you can reflect real money movements between your accounts
without polluting your profit numbers.

---

## 12. Quotations (sales pipeline)

Quotations are priced proposals to prospects — your pipeline *before* they become
paying clients.

### Fields

`title`, `prospect_name` (required), `company`, `email`, `phone`, `amount`,
`date`, `status` (`draft | sent | accepted | rejected`), `category`, `notes`,
`linked_client_id` (set on conversion), plus `attachment_count` and soft-delete.

### What you can do

- **Create / edit** quotations with full contact + pricing details.
- **Track status** through the pipeline: draft → sent → accepted/rejected, with
  color-coded badges and per-status counts.
- **Search** by title, prospect, company, or email; filter by status and date.
- **Attach files** (proposal PDFs, scopes of work).
- **Bulk-delete** and **close/reopen** (archive without deleting).
- **Convert to client** — one click turns a won quotation into a real client
  (name/company/contact/notes copied, status set to `active`), links the two via
  `linked_client_id`, and navigates to the new client. Conversion respects the
  client quota.

**Why it matters:** keep prospects separate from operational clients, measure
your win rate, and promote a deal to a client the moment it closes — with the
proposal documents carried along.

---

## 13. Dashboard & Analytics

### Dashboard (`/dashboard`)

The at-a-glance financial health of the active org:

- **KPI cards:** Total Revenue, Total Expenses, **Net Profit** (with margin %),
  and Active Clients (business) or Transaction Count (personal).
- **Bar chart** (recharts): incoming vs outgoing, bucketed by **client**
  (business) or **category** (personal), top buckets by volume.
- **Top breakdown card:** the top relationships/categories with their income,
  expense, and profit; clickable in business mode.
- **Latest transactions:** the most recent activity, each opening a detail peek.
- **Wealth overview:** a collapsible summary of all account balances with the
  privacy (eye) toggle.
- **Filtering:** multi-select **client** and **category** filters (search +
  checkboxes), a show/hide **closed clients** toggle, and clear-all. All figures
  respect the org's currency and update live.

### Analytics page (`/analytics`)

A deeper, **time-series** view powered by `GET /api/analytics`:

- **Granularity:** day / week / month / year, each with a sensible default
  lookback window.
- **Summary:** income, expense, profit, and transaction count for the range.
- **Series:** income/expense/profit over time (bar + line charts).
- **Breakdowns:** by category and by client.
- **Filters:** date range and the same client/category filters as the dashboard.

**Why it matters:** the dashboard answers "how am I doing right now?"; analytics
answers "how am I trending over time, and where is it coming from?".

---

## 14. Categories, Search & Filtering

- **Categories** are custom, per-org labels for transactions, managed inline
  (add / rename / delete) from the transactions filter UI and a dedicated
  **Categories** page (`/categories`). Deleting a category clears it from
  affected transactions.
- **Search** is available across clients, transactions, and quotations
  (description, name, company, email, category).
- **Filtering** combines tabs (type/status), date ranges, category multi-select,
  and client selection. Filter state is reflected in the URL so it survives
  navigation.

**Why it matters:** find anything fast and slice your money by cost center,
revenue stream, client, or time.

---

## 15. Attachments (files & receipts)

Attach supporting files — invoices, receipts, contracts, proposal PDFs — to
**transactions, clients, quotations, and wealth accounts**.

- **Storage:** files are stored as **base64 in the database** (no external
  bucket needed) for simplicity and portability.
- **Limits (free plan):** **1 MB** per file, **1 file** per item. **Premium:**
  **10 MB** per file, **10 files** per item, with a generous org-wide storage
  ceiling (see [Quotas](#20-plans--quotas-free-vs-premium)).
- **Metadata:** optional display name, tags, and category per file; created/
  updated timestamps and the uploading user.
- **UI:** a paperclip badge shows the count on list rows; a detail modal previews
  images, allows download, metadata edits, and deletion, and shows an audit
  history.

**Why it matters:** every number can carry its proof, so your records double as
an audit trail.

---

## 16. Trash & Soft-Delete (recovery)

Nothing is destroyed on the first delete. Clients, transactions, and quotations
are **soft-deleted** (a `deleted_at` timestamp) and moved to **Trash**.

- **Trash page (`/trash`):** tabbed by Clients / Quotations / Transactions, each
  item showing what it was and when it was deleted.
- **Restore:** brings an item back. Restoring a **client** also restores the
  transactions that were deleted *with* it (matched by deletion timestamp), and
  **re-applies** their wealth-account balance effects.
- **Purge:** permanent deletion (with confirmation). Purging a split removes all
  its legs; purging a client cascades to its transactions.
- **Balance safety:** soft-delete reverses an entry's balance immediately;
  restore re-applies it; purge doesn't double-count (already reversed at delete).

**Why it matters:** confident cleanup. Delete freely, recover instantly, and
your account balances never drift in the process.

---

## 17. Profile & Settings

From **Profile** (`/profile`) a user manages their personal account:

- **Full name** and optional contact details (phone with country code, address,
  city, state/region, postal code, country).
- **Language** (applies app-wide; see [i18n](#23-internationalization-8-languages--rtl)).
- **Default currency** (used as the default when creating new orgs).
- **Email** is read-only (managed by Clerk).

The app also records **legal acceptance** (privacy policy / terms / refund
policy, with versioning) and tracks onboarding state. The sidebar user menu
exposes Profile, Organizations, Admin Console (admins only), and Logout.

---

## 18. Currency & Multi-Currency

- **Currency is set per organization** (not per user). A freelancer's US org can
  be in USD while their India org is in INR.
- The active org's currency drives **all** displayed figures — client cards,
  transaction amounts, dashboard KPIs, analytics, and account balances.
- The user's **profile currency** is only the default suggested when creating a
  new org.
- Amounts use locale-aware formatting (compact notation like `$5K` / `€1.2M` on
  chart axes; full notation on cards and tooltips).

---

## 19. Subscriptions & Billing (Dodo Payments)

ProfitSync monetizes via a **Premium** subscription, billed through **Dodo
Payments**, a **Merchant of Record (MoR)**.

### Why Dodo (MoR)

A Merchant of Record automatically handles **localized currency** and
**VAT/GST/sales-tax compliance worldwide**, so a business can sell globally
without registering for tax in every country. Prices are defined in **USD**; the
buyer sees their **localized amount and tax** on Dodo's hosted checkout.

### Upgrade flow

```
SubscriptionPage → choose plan + cycle (monthly/yearly)
  → POST /api/billing/create-subscription   (creates Dodo subscription + hosted checkout)
  → redirect to Dodo checkout (collects billing address + payment; MoR handles tax)
  → return to /subscription
       ├─ POST /api/billing/sync       reconciles state on return (instant unlock)
       └─ POST /api/billing/webhook    Standard-Webhooks events keep state fresh
  → subscription becomes "active"
```

Two activation paths (return-URL **sync** + **webhook**) make activation robust
and **idempotent**: the plan unlocks immediately on return, while webhooks handle
renewals, cancellations, and dunning over time.

### Subscription lifecycle

`pending` → `active` → (`past_due` on failed renewal) / `cancelled`; `trialing`
if a trial is configured. **Cancellation is end-of-period**: you keep access
until the paid period ends (tracked via `cancel_at`), and it's reversible until
then.

### Key endpoints / files

`api/_routes/billing/{pricing,create-subscription,cancel,sync}.ts`,
`api/billing/webhook.ts` (its own function — needs the raw body for signature
verification), and the Dodo client in `api/_lib/dodo.ts`. The user-facing UI is
`src/pages/SubscriptionPage.tsx` (pricing, cancel, invoice list + PDF download).

---

## 20. Plans & Quotas (Free vs Premium)

Limits are **enforced server-side** in `api/_lib/quota.ts` and are configurable
per plan via the admin **Plans** panel (the `limits` JSON on the `plans` table).

| Limit | **Free** | **Premium** |
|---|---|---|
| Clients | 10 | 1,000 |
| Transactions per client | 30 | 10,000 |
| Quotations (org-wide) | 30 | 10,000 |
| Max file size per attachment | 1 MB | 10 MB |
| Attachments per item | 1 | 10 |
| Note length (chars) | 200 | 100,000 |
| Org-wide attachment storage | 50 MB | 5 GB |

**Pricing:** Premium price is defined in USD in the `plans` table and managed by
admins (seeded values are **$29/month** and **$290/year**; Dodo localizes the
displayed amount + tax at checkout). The exact public price is whatever the
plans table currently holds — always treat the admin Plans panel as the source
of truth.

**Where quotas are checked:** creating a client, transaction, quotation, or
attachment, and saving a note. A blocked action returns **HTTP 403** with a
human-readable reason and an upgrade hint. Personal accounts hide the
client/quotation limits in the UI.

---

## 21. Referral Program (earn rewards)

Users earn **real cash rewards** for inviting others who become paying
customers.

### End-to-end flow

1. **Get your code** — visiting `/referrals` creates a unique 8-character code
   (ambiguous characters omitted). Share the link `/?r=CODE`.
2. **Someone signs up via your link** — the code rides along through Clerk
   metadata and is attributed on their first `GET /api/profile`. A referral row
   is created with status **`signed_up`** (no reward yet — just the link).
3. **They make their first payment** — a Dodo webhook credits the reward
   (`creditReferralOnPaid`). The reward is snapshotted from current settings —
   either a **percentage** of the payment or a **fixed** amount — and enters a
   **holding period** (default **14 days**) before it's withdrawable. Status →
   **`paid`**.
4. **It becomes available** — after the holding window, the amount appears in
   your **available balance**.
5. **Request a payout** — choose **UPI**, **PayPal**, or **bank transfer**, enter
   an amount (≥ minimum, ≤ available). An atomic check prevents double-spend and
   only one pending request per user (`POST /api/referrals/payouts`).
6. **Admin reviews** — admins approve / reject / mark paid from the admin
   Referrals panel.

### Statuses

- **Referral:** `signed_up` → `paid` → `paid_out`.
- **Payout request:** `requested` → `approved` / `rejected` → `paid`.

### Admin-configurable settings

Reward type (percent or fixed) and amount, holding-period days, minimum payout,
and an optional promotional referral banner (toggle + custom text).

**Why it matters:** turns happy users into a growth channel, with abuse
protection (holding period, single pending request) and global payout options.

---

## 22. Admin Console

A separate console at **`/admin/**`**, restricted to users listed in the
`app_admins` table. Admins manage the whole platform:

| Area | What admins do |
|---|---|
| **Stats / overview** | MRR, signups, active users, revenue by plan, churn. |
| **Users** | Search, ban/unban, promote/demote admins, see org & premium counts. |
| **Organizations** | List, inspect, create for users, delete; org detail shows members, subscription & payment history, usage. |
| **Subscriptions** | View/filter, edit plan/status/cycle/dates, bulk cancel or downgrade to free, resync with Dodo. |
| **Invoices** | View/filter all invoices, download any org's invoice PDFs. |
| **Plans** | Edit plan name, USD price, discounts, **quota limits**, feature labels, and Dodo product IDs; enable/disable. |
| **Blog** | Create/edit/publish posts (SEO metadata, author, cover, tags). |
| **Referrals** | Review pending/paid referral credits and payout requests. |

---

## 23. Internationalization (8 languages + RTL)

The UI is fully translatable across **8 locales**:

| Code | Language | Direction |
|---|---|---|
| `en` | English (source/fallback) | LTR |
| `it` | Italiano | LTR |
| `de` | Deutsch | LTR |
| `hi` | हिन्दी | LTR |
| `ml` | മലയാളം | LTR |
| `ta` | தமிழ் | LTR |
| `te` | తెలుగు | LTR |
| `ar` | العربية | **RTL** |

- Powered by **i18next** with browser-language detection and a localStorage
  override (`profitsync-language`).
- **Arabic is right-to-left** — the app syncs `<html dir="rtl">` and uses
  RTL-aware styling on language change.
- English is the source of truth; a CI check (`npm run i18n:check`) blocks any
  new English key until every other locale has it (with interpolation
  placeholders intact).

---

## 24. Marketing Site, Blog & SEO/GEO

The app ships its own **public marketing site** and **blog**, server-rendered for
search engines and AI answer engines.

- **Landing page (`/`)** sections: Navbar, Hero, Trust bar, Features, How It
  Works, Analytics teaser, Value band, Pricing, Referral, Blog, Testimonials,
  FAQ, CTA, Footer.
- **Server-side rendering (`api/ssr.ts`):** the public pages (`/`, `/blog`,
  `/blog/:slug`, legal pages, `sitemap.xml`, `robots.txt`, `llms.txt`) ship real
  `<head>` tags (title, description, canonical, hreflang, OpenGraph/Twitter) and
  **JSON-LD** structured data (Organization, WebSite, SoftwareApplication,
  BlogPosting, FAQPage) so crawlers and LLMs see real content — not a blank SPA.
- **Blog:** admins author Markdown posts with cover image, author E-E-A-T fields,
  tags, and SEO metadata. Reading time is computed; an `## FAQ` section is
  auto-detected and emitted as FAQPage schema. Publishing pings **IndexNow** and
  refreshes the sitemap for fast indexing.
- **GEO (Generative Engine Optimization):** `robots.txt` welcomes major AI
  crawlers and `llms.txt` summarizes the product for LLMs — maximizing visibility
  in AI search.

---

## 25. Mobile App & PWA

### Native mobile app (Flutter)

A real native iOS/Android client lives in `mobile/profitsync_mobile/`. It shares
**the same backend API and the same Clerk auth** as the web app:

- **Auth** (Clerk email/password + social), **onboarding** (personal/business),
  **dashboard**, **clients**, **transactions**, **quotations**, and **profile**
  with a workspace switcher.
- Tabs adapt to the workspace type (personal hides Clients/Quotations).
- Requests carry the same `Authorization: Bearer` token and `x-org-id` header as
  the web client.

### Progressive Web App (PWA)

The authenticated app is **installable** ("Add to Home Screen") starting from the
login/app screens, with `start_url = /dashboard`:

- The **marketing landing page is deliberately excluded** from the service worker
  (multiple guards) so SEO/SSR isn't affected.
- Updates apply silently on the next navigation; a recovery reload handles stale
  cached chunks.

---

## 26. Architecture at a Glance (for developers)

- **Stack:** React 19 + TypeScript + Vite, Tailwind v4, shadcn/ui, react-router
  v7, react-hook-form + zod, **Clerk** (auth), **Neon Postgres** via **Drizzle
  ORM**, **Vercel** serverless functions, recharts, i18next, Vitest.
- **API:** a single consolidated router (`api/index.ts` + `src/lib/api-router.ts`)
  dispatches all `/api/*` requests to handlers under `api/_routes/**`, staying
  within Vercel Hobby's 12-function cap. Exceptions are their own functions: the
  **billing webhook** (needs raw body) and **SSR** (`api/ssr.ts`).
- **Auth & scoping:** every route calls `requireAuth()`, which verifies the
  Clerk JWT, resolves the active org from `x-org-id`, and returns
  `{ userId, orgId, role }`. **All queries are scoped by `orgId`** — never by
  user alone. An LRU cache (60s) avoids per-request membership lookups.
- **Serialization:** `serialize()` converts Drizzle's camelCase rows to
  snake_case before every JSON response.
- **Client API:** `apiGet/apiPost/apiPatch/apiDelete` attach the bearer token +
  `x-org-id`; `apiGet` has a 30s cache with in-flight dedup; any mutation clears
  the cache.
- **Money-critical invariants:** wealth ledger math (`wealth-ledger.ts`) and
  split/leg grouping (`tx-grouping.ts`, `tx-legs.ts`) are unit-tested so balances
  never drift across create/edit/delete/restore.
- **Quality gate:** a pre-commit hook and CI run the same sequence —
  `i18n:check → lint → typecheck → test:ci`.

---

## 27. Feature Availability Matrix

| Feature | Free | Premium | Personal org | Business org |
|---|---|---|---|---|
| Wealth accounts (cash + up to 5 banks) | ✅ | ✅ | ✅ | ✅ |
| Transactions (income/expense) | ✅ (limits) | ✅ | ✅ | ✅ |
| **Split transactions** | ✅ (counts per leg) | ✅ | ✅ | ✅ |
| **Transfers between accounts** | ✅ | ✅ | ✅ | ✅ |
| Clients CRM | ✅ (≤10) | ✅ (≤1,000) | — (gated) | ✅ |
| Quotations + convert-to-client | ✅ (≤30) | ✅ (≤10,000) | — (gated) | ✅ |
| Dashboard & Analytics | ✅ | ✅ | ✅ | ✅ |
| Attachments | ✅ (1 MB ×1) | ✅ (10 MB ×10) | ✅ | ✅ |
| Trash / restore / purge | ✅ | ✅ | ✅ | ✅ |
| Team members & roles | — | — | — | ✅ |
| Invitations | — | — | — | ✅ |
| Referral program & payouts | ✅ | ✅ | ✅ | ✅ |
| 8 languages + RTL | ✅ | ✅ | ✅ | ✅ |
| Mobile app + PWA install | ✅ | ✅ | ✅ | ✅ |
| Admin console | App admins only | — | — | — |

---

*This document describes ProfitSync as implemented in the codebase. For the
billing model and its sync invariants, also see `subscription_plan.md`; for the
SEO/GEO playbook, see `docs/seo/PLAN.md`; for the wealth/accounts design, see
`docs/wealth-overhaul/PLAN.md`.*
