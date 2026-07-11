import { pgTable, uuid, text, numeric, date, timestamp, integer, boolean, index, uniqueIndex, jsonb, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: text("owner_user_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  isPersonal: boolean("is_personal").notNull().default(false),
  // The org's feature tier, chosen during onboarding. Drives feature gating
  // (Clients / Quotations / member management are business-only). Nullable for
  // historical rows; treated as "business" (full features) when absent.
  accountType: text("account_type"), // personal | business
  currency: text("currency").notNull().default("USD"),
  // Workspace logo: base64 bytes + sniffed mime (client resizes to ≤256px before
  // upload, server re-validates). Exposed to the UI as a `logo_src` data URL.
  logoData: text("logo_data").notNull().default(""),
  logoMime: text("logo_mime").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  ownerIdx: index("organizations_owner_idx").on(table.ownerUserId),
}))

export const organizationMembers = pgTable("organization_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("owner"), // owner | admin | editor | viewer
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  orgIdx: index("organization_members_org_idx").on(table.organizationId),
  userIdx: index("organization_members_user_idx").on(table.userId),
}))

export const organizationInvitations = pgTable("organization_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull().default("editor"),
  token: text("token").notNull().unique(),
  invitedByUserId: text("invited_by_user_id").notNull(),
  acceptedAt: timestamp("accepted_at"),
  declinedAt: timestamp("declined_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  orgIdx: index("organization_invitations_org_idx").on(table.organizationId),
  emailIdx: index("organization_invitations_email_idx").on(table.email),
  tokenIdx: index("organization_invitations_token_idx").on(table.token),
}))

export const legalAcceptances = pgTable("legal_acceptances", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  document: text("document").notNull(), // privacy_policy | terms_of_service
  version: text("version").notNull(),
  acceptedAt: timestamp("accepted_at").defaultNow(),
}, (table) => ({
  userIdx: index("legal_acceptances_user_idx").on(table.userId),
}))

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  organizationId: uuid("organization_id"),
  name: text("name").notNull(),
  company: text("company").default(""),
  email: text("email").default(""),
  phone: text("phone").default(""),
  status: text("status").default("active"),
  notes: text("notes").default(""),
  category: text("category").notNull().default(""), // optional category label (type "client")
  // The workspace's own/internal client — the company (or person) itself. Used to
  // record own expenses (rent, utilities, salaries). Exactly one per org; shown
  // first and badged distinctly in lists/pickers. Personal orgs use it as their
  // single hidden anchor client.
  isOwn: boolean("is_own").notNull().default(false),
  onboardDate: date("onboard_date"),
  deletedAt: timestamp("deleted_at"),
  // When set, the client is "closed": kept for history but excluded from the
  // default list and from analytics aggregation. Distinct from soft-delete and
  // reversible (reopen clears it).
  closedAt: timestamp("closed_at"),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("clients_org_idx").on(table.organizationId),
}))

// Org-scoped, managed transaction categories. Transactions still store the
// category *name* as free text (transactions.category) for back-compat; this
// table is the source of truth for the picker and the management UI. Renaming a
// category bulk-updates matching transactions; deleting leaves their text intact.
export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // "incoming" | "outgoing"
  color: text("color").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgTypeIdx: index("categories_org_type_idx").on(table.organizationId, table.type),
  orgNameTypeUnique: uniqueIndex("categories_org_name_type_unique").on(table.organizationId, table.type, table.name),
}))

export const wealthAccounts = pgTable("wealth_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // bank | cash | space (space = a personal savings bucket)
  bankName: text("bank_name").notNull().default(""),
  nickname: text("nickname").notNull().default(""),
  openingBalance: numeric("opening_balance", { precision: 20, scale: 2 }).notNull().default("0"),
  currentBalance: numeric("current_balance", { precision: 20, scale: 2 }).notNull().default("0"),
  icon: text("icon").notNull().default("bank"),
  // Bank brand: the logo source URL (rendered) + a base64 copy stored for
  // resilience ("logo stored on backend"); `brandDomain` is the resolved domain
  // used to (re)fetch the logo.
  brandDomain: text("brand_domain").notNull().default(""),
  logoUrl: text("logo_url").notNull().default(""),
  logoData: text("logo_data").notNull().default(""), // base64, never returned in list responses
  // Banking identifiers. The LABEL of the primary/secondary field is dynamic per
  // country (IBAN vs Account Number vs IFSC/Sort/Routing/BSB…); the storage is
  // generic. See src/lib/bank-fields.ts.
  country: text("country").notNull().default(""), // ISO 3166-1 alpha-2
  accountNumber: text("account_number").notNull().default(""), // IBAN or local account number
  routingNumber: text("routing_number").notNull().default(""), // IFSC / Sort Code / Routing / BSB / Transit …
  swift: text("swift").notNull().default(""), // SWIFT / BIC
  address: text("address").notNull().default(""),
  location: text("location").notNull().default(""), // city / branch label
  note: text("note").notNull().default(""),
  // ── Savings goal (type='space' only; NULL for bank/cash) ──────────────────
  // A Space can carry an optional target amount + date; the monthly-contribution
  // SUGGESTION is computed (src/lib/spaces.ts), never stored, so it can't drift.
  goalAmount: numeric("goal_amount", { precision: 20, scale: 2 }),
  targetDate: date("target_date"),
  // User-defined card order within the org (lower = earlier). Set via the
  // drag-to-reorder UI; ties fall back to createdAt so pre-existing rows keep
  // their original order until first reordered.
  position: integer("position").notNull().default(0),
  // The org's default account: preselected in transaction forms and badged in
  // lists. The partial unique index below guarantees at most one ACTIVE default
  // per org; setting a new default flips the others off in one statement.
  isDefault: boolean("is_default").notNull().default(false),
  archivedAt: timestamp("archived_at"),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("wealth_accounts_org_idx").on(table.organizationId),
  oneDefaultPerOrg: uniqueIndex("wealth_accounts_one_default_idx")
    .on(table.organizationId)
    .where(sql`is_default = true AND archived_at IS NULL`),
}))

export const wealthAccountAttachments = pgTable("wealth_account_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  wealthAccountId: uuid("wealth_account_id").notNull().references(() => wealthAccounts.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size").notNull(),
  fileData: text("file_data").notNull(),
  displayName: text("display_name"),
  tags: jsonb("tags").notNull().default([]),
  category: text("category").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  accountIdx: index("wealth_account_attachments_account_idx").on(table.wealthAccountId),
}))

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  wealthAccountId: uuid("wealth_account_id").references(() => wealthAccounts.id, { onDelete: "set null" }),
  // Links the legs of a single logical transaction that was paid from / split
  // across multiple wealth accounts (e.g. €100 = €30 cash + €25 AC1 + €45 AC2).
  // All legs share one group_id; a single-account transaction has group_id NULL.
  // Also used to pair the two legs of an account-to-account transfer.
  groupId: uuid("group_id"),
  // 'standard' for normal income/expense (incl. splits); 'transfer' for the two
  // legs of an account-to-account move. Transfers are real, balance-affecting
  // rows but are excluded from the global transactions list, the income/expense
  // summary, and analytics (they net to zero and aren't P&L).
  kind: text("kind").notNull().default("standard"), // standard | transfer
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull().default("0"),
  description: text("description").default(""),
  category: text("category").default(""),
  date: date("date").notNull().defaultNow(),
  isSystem: boolean("is_system").notNull().default(false),
  // Set when this row was auto-created by a recurring rule: the rule id (kept
  // for the list icon; nulled if the rule is deleted) and the occurrence date.
  // The unique index below is the materializer's idempotency key — a catch-up
  // can never create the same occurrence twice. NULLs are distinct in Postgres,
  // so ordinary rows (both columns NULL) never conflict.
  recurringRuleId: uuid("recurring_rule_id"),
  recurringDueDate: date("recurring_due_date"),
  // Soft-delete: deleted transactions move to Trash (restore/purge) instead of
  // disappearing. All financial aggregates must exclude rows where this is set.
  deletedAt: timestamp("deleted_at"),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  groupIdx: index("transactions_group_idx").on(table.groupId),
  recurringOnceIdx: uniqueIndex("transactions_recurring_once_idx").on(table.recurringRuleId, table.recurringDueDate),
  // Hot predicates at scale: per-client lists + quota counts, per-account
  // ledgers, and date-range scans (calendar / from-to filters).
  clientIdx: index("transactions_client_idx").on(table.clientId),
  accountIdx: index("transactions_account_idx").on(table.wealthAccountId),
  dateIdx: index("transactions_date_idx").on(table.date),
}))

// ── Recurring payments ───────────────────────────────────────────────────────
// A rule describes money that repeats (rent, salary, subscription…): WHO it
// belongs to (a client, or the org's own/anchor client when client_id is NULL),
// WHERE it moves money (an optional wealth account), and WHEN it fires
// (anchor start_date + unit×interval, optional inclusive end_date).
// `next_due_at` is the cursor: the first occurrence not yet materialized. The
// materializer (api/_lib/recurring-materialize.ts) turns due occurrences into
// REAL transaction rows idempotently and applies wealth balance deltas only
// for rows it actually inserted.
export const recurringRules = pgTable("recurring_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  // NULL = the org's own/internal client (personal orgs' anchor client).
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  // The account the money comes from / goes to. Optional; archived accounts
  // pause materialization with last_error instead of corrupting balances.
  wealthAccountId: uuid("wealth_account_id").references(() => wealthAccounts.id, { onDelete: "set null" }),
  // 'standard' = a normal income/outgoing occurrence (the original behaviour).
  // 'transfer' = a recurring auto-save: each occurrence materializes a TWO-LEG
  // transfer (outgoing from `wealthAccountId` → incoming to `toAccountId`, a
  // Space). Idempotency anchors on the OUTGOING leg only, so the unique index on
  // (recurring_rule_id, recurring_due_date) never double-conflicts.
  kind: text("kind").notNull().default("standard"), // standard | transfer
  toAccountId: uuid("to_account_id").references(() => wealthAccounts.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // incoming | outgoing (for a transfer: the source-leg direction, always 'outgoing')
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  category: text("category").notNull().default(""),
  frequencyUnit: text("frequency_unit").notNull(), // day | week | month | year
  frequencyInterval: integer("frequency_interval").notNull().default(1),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  nextDueAt: date("next_due_at").notNull(),
  active: boolean("active").notNull().default(true),
  // Why the last materialization skipped this rule (quota, archived account…).
  // Cleared on the next successful run; surfaced in the rules list.
  lastError: text("last_error").notNull().default(""),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  dueIdx: index("recurring_rules_due_idx").on(table.organizationId, table.active, table.nextDueAt),
}))

export const quotations = pgTable("quotations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  organizationId: uuid("organization_id"),
  title: text("title").notNull(),
  prospectName: text("prospect_name").notNull(),
  company: text("company").default(""),
  email: text("email").default(""),
  phone: text("phone").default(""),
  amount: numeric("amount", { precision: 20, scale: 2 }).default("0"),
  // User-provided quotation date (e.g. when it was issued). Defaults to today.
  date: date("date").notNull().defaultNow(),
  status: text("status").default("draft"), // draft | sent | accepted | rejected
  notes: text("notes").default(""),
  category: text("category").notNull().default(""), // optional category label (type "quotation")
  linkedClientId: uuid("linked_client_id"), // set when converted to a client
  deletedAt: timestamp("deleted_at"),
  // When set, the quotation is "closed": excluded from the default list, shown in
  // a separate section. Reversible (reopen clears it).
  closedAt: timestamp("closed_at"),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("quotations_org_idx").on(table.organizationId),
}))

// Append-only change history for the main entities. `changes` holds a
// field → { from, to } map for updates; create/delete/close/reopen carry no diff.
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(), // client | transaction | quotation
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(), // create | update | delete | close | reopen
  actorUserId: text("actor_user_id"),
  changes: jsonb("changes").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  entityIdx: index("audit_logs_entity_idx").on(table.organizationId, table.entityType, table.entityId),
}))

export const transactionAttachments = pgTable("transaction_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size").notNull(),
  fileData: text("file_data").notNull(),
  // Editable display name (falls back to fileName) + user organisation metadata.
  displayName: text("display_name"),
  tags: jsonb("tags").notNull().default([]),
  category: text("category").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})

export const quotationAttachments = pgTable("quotation_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  quotationId: uuid("quotation_id").notNull().references(() => quotations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size").notNull(),
  fileData: text("file_data").notNull(),
  displayName: text("display_name"),
  tags: jsonb("tags").notNull().default([]),
  category: text("category").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})

export const clientAttachments = pgTable("client_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size").notNull(),
  fileData: text("file_data").notNull(),
  displayName: text("display_name"),
  tags: jsonb("tags").notNull().default([]),
  category: text("category").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  clientIdx: index("client_attachments_client_idx").on(table.clientId),
}))

export const userProfiles = pgTable("user_profiles", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name"),
  currency: text("currency").default("USD"),
  language: text("language").default("en"),
  currentOrganizationId: uuid("current_organization_id"),
  termsAcceptedAt: timestamp("terms_accepted_at"),
  // Set the first time a user completes the Personal/Business onboarding flow.
  // Null → the onboarding screen is shown on next app load.
  onboardedAt: timestamp("onboarded_at"),
  bannedAt: timestamp("banned_at"),
  // Dashboard "Try a Company account" upsell state. `dismissedAt` records the last
  // time the user closed the banner (it reappears 72h later); `hidden` is the
  // durable "never show again" opt-out.
  companyUpsellDismissedAt: timestamp("company_upsell_dismissed_at"),
  companyUpsellHidden: boolean("company_upsell_hidden").notNull().default(false),
  // Optional contact details (all free-form, never required).
  address: text("address").notNull().default(""),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  postalCode: text("postal_code").notNull().default(""),
  country: text("country").notNull().default(""), // ISO 3166-1 alpha-2
  phoneCountryCode: text("phone_country_code").notNull().default(""), // dial code, e.g. "+91"
  phone: text("phone").notNull().default(""), // national number
  // Profile picture: base64 bytes + sniffed mime (client resizes to ≤256px
  // before upload, server re-validates). Exposed as an `avatar_src` data URL.
  avatarData: text("avatar_data").notNull().default(""),
  avatarMime: text("avatar_mime").notNull().default(""),
  // Custom dashboard arrangement: { version, contexts: { personal, business } },
  // each context = { order: cardId[], hidden: cardId[] }. Normalized against
  // the card registry on read (src/lib/dashboard-layout.ts). {} = defaults.
  dashboardLayout: jsonb("dashboard_layout").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})

// ── Referral program ────────────────────────────────────────────────────────
// One shareable code per user.
export const referralCodes = pgTable("referral_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().unique(),
  code: text("code").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
})

// A referred user is recorded once (unique referredUserId). The reward amount,
// currency, type and percent are SNAPSHOTTED at the moment the referral becomes
// "paid", so later changes to settings never retroactively alter owed money.
export const referrals = pgTable("referrals", {
  id: uuid("id").primaryKey().defaultRandom(),
  referrerUserId: text("referrer_user_id").notNull(),
  referredUserId: text("referred_user_id").notNull().unique(),
  code: text("code").notNull(),
  status: text("status").notNull().default("signed_up"), // signed_up | paid | paid_out
  organizationId: uuid("organization_id"), // the paying org, set when paid
  rewardAmount: numeric("reward_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  rewardCurrency: text("reward_currency").notNull().default("USD"),
  rewardType: text("reward_type"), // percent | fixed (snapshot)
  rewardPercent: numeric("reward_percent", { precision: 5, scale: 2 }), // snapshot, if percent
  qualifyingAt: timestamp("qualifying_at"), // payout-eligible from this time (holding period)
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  referrerIdx: index("referrals_referrer_idx").on(table.referrerUserId),
}))

// Single-row, admin-managed program configuration (id is a fixed sentinel).
export const referralSettings = pgTable("referral_settings", {
  id: text("id").primaryKey(), // always "default"
  rewardType: text("reward_type").notNull().default("percent"), // percent | fixed
  rewardPercent: numeric("reward_percent", { precision: 5, scale: 2 }).notNull().default("25"),
  rewardAmount: numeric("reward_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  rewardCurrency: text("reward_currency").notNull().default("USD"),
  holdingDays: integer("holding_days").notNull().default(14),
  minPayout: numeric("min_payout", { precision: 12, scale: 2 }).notNull().default("0"),
  bannerEnabled: boolean("banner_enabled").notNull().default(false),
  bannerText: text("banner_text").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow(),
})

export const payoutRequests = pgTable("payout_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  method: text("method").notNull(), // upi | paypal | bank
  details: jsonb("details").notNull().default({}),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("requested"), // requested | approved | paid | rejected
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  userIdx: index("payout_requests_user_idx").on(table.userId),
  // At most one *pending* request per user. This atomically prevents concurrent
  // payout requests from each passing the balance check and double-spending.
  onePending: uniqueIndex("payout_requests_one_pending_idx").on(table.userId).where(sql`status = 'requested'`),
}))

export const appAdmins = pgTable("app_admins", {
  userId: text("user_id").primaryKey(),
  // Platform-admin role → capability set (see src/lib/admin-roles.ts). Defaults
  // to super_admin so every pre-existing admin keeps full access on migration.
  // Either a SYSTEM role (super_admin | editor | viewer | blog_writer) or the
  // `key` of a CUSTOM role in admin_roles below.
  role: text("role").notNull().default("super_admin"),
  createdAt: timestamp("created_at").defaultNow(),
})

// ── Custom admin roles ───────────────────────────────────────────────────────
// Super-admin-defined roles for the /admin console. `capabilities` may only
// hold GRANTABLE_ADMIN_CAPS (validated on write AND re-filtered on read — the
// super-only capabilities org_transactions / manage_super_admins / manage_roles
// can never live here). Deleting a role in use by an app_admins row is blocked.
export const adminRoles = pgTable("admin_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(), // slug; must not collide with system role names
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  capabilities: jsonb("capabilities").notNull().default([]),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(), // free | personal | business (legacy: premium)
  name: text("name").notNull(),
  description: text("description").notNull().default(""), // synced from the Dodo product
  // Which account type this plan serves. Null for the shared "free" tier.
  accountType: text("account_type"), // personal | business | null
  isActive: boolean("is_active").notNull().default(true),
  monthlyPriceUsd: numeric("monthly_price_usd", { precision: 12, scale: 2 }).notNull().default("0"),
  yearlyPriceUsd: numeric("yearly_price_usd", { precision: 12, scale: 2 }).notNull().default("0"),
  monthlyDiscountPct: integer("monthly_discount_pct").notNull().default(0),
  yearlyDiscountPct: integer("yearly_discount_pct").notNull().default(0),
  // Admin-editable promotional line shown on the plan card (e.g. "First month
  // 50% off"). Empty → the UI falls back to a discount-derived default.
  promoNote: text("promo_note").notNull().default(""),
  // Dodo Payments product IDs per billing cycle. Source of truth for checkout;
  // admins set these in the admin panel and the rest is derived from Dodo.
  dodoProductMonthly: text("dodo_product_monthly"),
  dodoProductYearly: text("dodo_product_yearly"),
  // Which Dodo environment this plan's product IDs live in. Test products only
  // resolve against test.dodopayments.com (with a test key); live against live.
  // Threaded into every Dodo call for this plan and its subscriptions.
  dodoEnvironment: text("dodo_environment").notNull().default("live"), // test | live
  limits: jsonb("limits").notNull().default({}), // { clients, transactionsPerClient, quotations, attachmentSizeKb, attachmentsPerTx, noteLength } — REAL numeric limits used by quota
  featureLabels: jsonb("feature_labels").notNull().default({}), // { <limitKey>: "display string" } — shown in the plan's feature list
  dodoMetadata: jsonb("dodo_metadata").notNull().default({}), // raw data synced from Dodo: { monthly: {...}, yearly: {...} }
  geoPricing: jsonb("geo_pricing").notNull().default({}), // { country_code: { currency, monthly, yearly, monthlyDiscountPct, yearlyDiscountPct } }
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  planKey: text("plan_key").notNull().default("free"),
  status: text("status").notNull().default("active"), // active | past_due | cancelled | trialing
  billingCycle: text("billing_cycle"), // monthly | yearly | null for free
  // Snapshot of the plan's dodo_environment at checkout time, so cancel/sync/
  // invoice keep calling the right Dodo env even if the plan is later changed.
  // null for free/stub/legacy rows → callers fall back to "live".
  dodoEnvironment: text("dodo_environment"), // test | live | null
  // The billing_currency the checkout was created with (org preference resolved
  // via src/lib/billing-currency.ts). A SNAPSHOT for admin visibility — the
  // authoritative charge currency is always invoices.currency from Dodo.
  billingCurrency: text("billing_currency"), // ISO 4217 | null (legacy/free)
  provider: text("provider"), // dodo | stub | manual | null
  providerSubscriptionId: text("provider_subscription_id"),
  // Start of the current paid period (Dodo `previous_billing_date`). Paired with
  // currentPeriodEnd (the next renewal / `next_billing_date`) so the UI can show
  // both "started" and "renews on" instead of one ambiguous date.
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  // A plan change scheduled for the next billing date (e.g. monthly → yearly):
  // { billing_cycle, product_id, effective_at }. Null when no change is pending.
  scheduledChange: jsonb("scheduled_change"),
  cancelAt: timestamp("cancel_at"),
  cancelledAt: timestamp("cancelled_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("subscriptions_org_idx").on(table.organizationId),
}))

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("draft"), // draft | open | paid | uncollectible | void | refunded
  provider: text("provider"),
  providerInvoiceId: text("provider_invoice_id"),
  pdfUrl: text("pdf_url"),
  issuedAt: timestamp("issued_at").defaultNow(),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  orgIdx: index("invoices_org_idx").on(table.organizationId),
  // One invoice per Dodo payment. Enables an atomic upsert so concurrent
  // reconcile/webhook writes can't create duplicate rows for the same payment.
  // Nullable column → Postgres treats NULLs as distinct, so non-Dodo invoices
  // (no provider_invoice_id) are unaffected.
  providerInvoiceIdx: uniqueIndex("invoices_provider_invoice_id_key").on(table.providerInvoiceId),
}))

// ── Billing attempts ─────────────────────────────────────────────────────────
// One row per paid-plan checkout attempt: who clicked subscribe, what happened
// (created → redirected → completed | failed | abandoned), the Dodo error when
// it failed, and admin-managed follow-up status + notes. Written by the
// non-fatal logger in api/_lib/billing-attempts.ts (a logging failure must
// never break the money path). Org/email/name are SNAPSHOTS at attempt time so
// the admin panel can search without joins and history survives org changes.
export const billingAttempts = pgTable("billing_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  ownerEmail: text("owner_email").notNull().default(""),
  organizationName: text("organization_name").notNull().default(""),
  planKey: text("plan_key").notNull(),
  billingCycle: text("billing_cycle"), // monthly | yearly | null
  currency: text("currency"), // billing_currency used at checkout (null = product base)
  provider: text("provider").notNull().default("dodo"), // dodo | stub
  status: text("status").notNull().default("created"), // created | redirected | completed | failed | abandoned
  dodoSubscriptionId: text("dodo_subscription_id"),
  dodoPaymentId: text("dodo_payment_id"),
  providerErrorMessage: text("provider_error_message").notNull().default(""),
  webhookErrorDetails: jsonb("webhook_error_details"), // raw payment.failed payload for forensics
  followUpStatus: text("follow_up_status").notNull().default("none"), // none | contacted | resolved | paid_later
  followUpNotes: text("follow_up_notes").notNull().default(""),
  completedAt: timestamp("completed_at"), // set on any terminal transition
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgCreatedIdx: index("billing_attempts_org_created_idx").on(table.organizationId, table.createdAt),
  statusCreatedIdx: index("billing_attempts_status_created_idx").on(table.status, table.createdAt),
  dodoSubIdx: index("billing_attempts_dodo_sub_idx").on(table.dodoSubscriptionId),
}))

// ── Blog ─────────────────────────────────────────────────────────────────────
// Platform-wide marketing content authored by app admins (NOT org-scoped — it
// follows the global `plans` / `referral_settings` pattern). Public read routes
// expose only published posts; the admin console manages the full lifecycle
// (create / edit / delete / publish / unpublish). Body is stored as Markdown and
// rendered safely (no raw HTML) on the public site.
export const blogPosts = pgTable("blog_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  // URL slug for /blog/:slug — unique, derived from the title but editable.
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  excerpt: text("excerpt").notNull().default(""), // short summary for cards + meta description fallback
  content: text("content").notNull().default(""), // Markdown body
  coverImageUrl: text("cover_image_url").notNull().default(""), // hero image URL (optional)
  tags: jsonb("tags").notNull().default([]), // string[]
  authorName: text("author_name").notNull().default(""), // display author (free text)
  authorUserId: text("author_user_id"), // Clerk id of the admin who created it
  status: text("status").notNull().default("draft"), // draft | published
  // SEO overrides; fall back to title/excerpt when blank.
  seoTitle: text("seo_title").notNull().default(""),
  seoDescription: text("seo_description").notNull().default(""),
  // Author E-E-A-T signals (Experience / Expertise / Authoritativeness / Trust).
  // Surfaced both as a visible byline on the post and as a schema.org Person in
  // the BlogPosting JSON-LD — verified 2025-26 research shows recognizable,
  // externally-linked authors materially improve how Google + AI engines attribute
  // and cite content. All optional: blank → omitted from schema / hidden in byline.
  authorJobTitle: text("author_job_title").notNull().default(""), // e.g. "Founder, ProfitSync"
  authorBio: text("author_bio").notNull().default(""), // 1–2 sentence credential line
  authorUrl: text("author_url").notNull().default(""), // external profile (LinkedIn, etc.) → author.url + sameAs
  authorImageUrl: text("author_image_url").notNull().default(""), // headshot → author.image
  // Dedicated 1200×630 social/OG image override. Falls back to coverImageUrl, then
  // the site-wide default. A landscape card out-performs the square logo in every
  // social unfurl (X, LinkedIn, Slack, Discord, WhatsApp, iMessage).
  ogImageUrl: text("og_image_url").notNull().default(""),
  // Topic-cluster / pillar this post belongs to (e.g. "Cash Flow"). Emitted as
  // schema articleSection and used for on-site grouping + internal linking.
  articleSection: text("article_section").notNull().default(""),
  // Estimated reading time in minutes, computed from `content` at write time
  // (single source of truth: readingTimeMinutes() in src/lib/blog.ts). Stored so
  // the public list never has to fetch the full Markdown body just to derive it.
  readingTimeMinutes: integer("reading_time_minutes").notNull().default(1),
  // Set the first time the post is published; preserved across unpublish/republish
  // so the public ordering stays stable. Null while it has never been published.
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  // Drives the public list query: filter by status, order by publishedAt.
  statusPublishedIdx: index("blog_posts_status_published_idx").on(table.status, table.publishedAt),
  // Defense-in-depth: a published post must always have a publish timestamp, so
  // the public feed ordering (by published_at) can never be broken by a row with
  // status='published' and published_at IS NULL.
  publishedHasDate: check(
    "blog_posts_published_has_date",
    sql`status <> 'published' OR published_at IS NOT NULL`,
  ),
}))

// Expense (outgoing) budgets. Business orgs set one per client (incl. their own
// company client) plus an optional org-level DEFAULT (client_id NULL) used as the
// template/prefill for clients without their own. Personal orgs set a single
// personal budget (client_id NULL). `period` defines the rolling window the spend
// is measured against. Spend is always derived from outgoing transactions — never
// stored here — so the budget row only holds the target + cadence.
export const budgets = pgTable("budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  // NULL = the org-level budget: the personal budget for a personal org, or the
  // default-for-clients template for a business org. Non-null = a specific client.
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  period: text("period").notNull().default("monthly"), // lifetime | monthly | weekly | daily
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull().default("0"),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("budgets_org_idx").on(table.organizationId),
  // At most one budget per client …
  orgClientUnique: uniqueIndex("budgets_org_client_unique")
    .on(table.organizationId, table.clientId)
    .where(sql`client_id IS NOT NULL`),
  // … and at most one org-level (NULL-client) budget per org.
  orgDefaultUnique: uniqueIndex("budgets_org_default_unique")
    .on(table.organizationId)
    .where(sql`client_id IS NULL`),
}))

// Append-only audit of budget changes (set / raise / lower / period change / remove).
// Keyed by (org, client_id) — NOT a FK to budgets.id — because a budget row is deleted
// on "remove" and the history must survive that (and a later re-set). `amount`/`period`
// snapshot the state AFTER the change, so "the budget in effect at time T" is just the
// latest row with created_at <= T. Drives the budget history timeline + insights.
export const budgetHistory = pgTable("budget_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }), // NULL = personal / business-default budget
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull().default("0"), // snapshot after the change (0 for "remove")
  period: text("period").notNull(), // lifetime | monthly | weekly | daily (after the change)
  action: text("action").notNull(), // set | raise | lower | period_change | remove
  changedBy: text("changed_by"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  lookupIdx: index("budget_history_lookup_idx").on(table.organizationId, table.clientId, table.createdAt),
}))

// ── Push delivery log ──────────────────────────────────────────────────────────
// One row per sendWebPushToUser fan-out (aggregate counts, not per-device), so
// admins can see WHETHER pushes go out and WHY they fail without prod console
// access. Written best-effort by the sender — logging can never affect delivery.
export const pushEvents = pgTable("push_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  /** What triggered the send — a notification type or 'test'. */
  source: text("source").notNull().default(""),
  outcome: text("outcome").notNull(), // ok | partial | failed | no_subs | unconfigured
  subscriptions: integer("subscriptions").notNull().default(0),
  ok: integer("ok").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  pruned: integer("pruned").notNull().default(0),
  /** First distinct error summaries, comma-joined (diagnostics only). */
  errors: text("errors").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  createdIdx: index("push_events_created_idx").on(table.createdAt),
}))

// ── Notification scheduler heartbeat ──────────────────────────────────────────
// Single-row liveness record: runNotificationTick upserts it on EVERY tick (even
// zero-work ones), so the admin panel can tell "the scheduler is running" apart
// from "nothing was due" — and flag a dead driver instead of silently dropping
// reminders/broadcasts (the June'26 outage mode: the worker stopped and nothing
// noticed for days).
export const notificationSchedulerState = pgTable("notification_scheduler_state", {
  id: text("id").primaryKey().default("default"),
  lastTickAt: timestamp("last_tick_at").notNull().defaultNow(),
  lastReminders: integer("last_reminders").notNull().default(0),
  lastBroadcasts: integer("last_broadcasts").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
})

// ── Notifications ─────────────────────────────────────────────────────────────
// Persisted, per-recipient notifications. Platform-agnostic: any client (web,
// PWA, future native app / wearable) reads these via /api/notifications, so the
// bell + history are just a view over these rows. `organization_id` is NULL for
// account-level notifications (e.g. a cross-org invitation) so they surface
// regardless of the active org.
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(), // recipient (Clerk userId)
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // see NOTIFICATION_TYPES in src/lib/notifications.ts
  category: text("category").notNull().default("system"), // grouping for preferences
  title: text("title").notNull(), // English fallback; client prefers data.i18nKey
  body: text("body").notNull().default(""),
  // i18n + navigation payload: { i18nKey?, i18nParams?, ... }. The client renders
  // data.i18nKey in the user's language when present, falling back to title/body.
  data: jsonb("data").notNull().default({}),
  link: text("link"), // in-app route to open on click
  actorUserId: text("actor_user_id"), // who triggered it, if applicable
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  // Set for event-sourced notifications to make repeated webhooks / lazy GETs
  // idempotent (see onePerDedupe).
  dedupeKey: text("dedupe_key"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  // The bell/history query: a recipient's rows, newest first.
  recipientIdx: index("notifications_recipient_idx").on(table.userId, table.organizationId, table.createdAt),
  // Cheap unread-count lookups.
  unreadIdx: index("notifications_unread_idx").on(table.userId, table.readAt),
  // At most one notification per (recipient, dedupe_key): webhook retries and
  // repeated lazy materialization can't double-notify.
  onePerDedupe: uniqueIndex("notifications_user_dedupe_unique")
    .on(table.userId, table.dedupeKey)
    .where(sql`dedupe_key IS NOT NULL`),
}))

// ── Notification preferences ──────────────────────────────────────────────────
// One polymorphic row per (scope, target): scope='user' → user_id; 'organization'
// → organization_id; 'client' → (organization_id, client_id). `preferences` holds
// the NotificationPreferences shape from src/lib/notifications.ts (per-category
// channel toggles + a master mute). Resolution cascades client → org → user →
// system defaults.
export const notificationPreferences = pgTable("notification_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: text("scope").notNull(), // user | organization | client
  userId: text("user_id"), // set when scope='user'
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  preferences: jsonb("preferences").notNull().default({}),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  // At most one row per scope target (NULL columns are excluded by the partial
  // predicate so the unique key never spans irrelevant nulls).
  userScopeUnique: uniqueIndex("notif_prefs_user_unique").on(table.userId).where(sql`scope = 'user'`),
  orgScopeUnique: uniqueIndex("notif_prefs_org_unique").on(table.organizationId).where(sql`scope = 'organization'`),
  clientScopeUnique: uniqueIndex("notif_prefs_client_unique")
    .on(table.organizationId, table.clientId)
    .where(sql`scope = 'client'`),
}))

// ── Push subscriptions ────────────────────────────────────────────────────────
// Delivery endpoints for push channels. `channel='web_push'` rows store the Web
// Push endpoint + VAPID keys. Future native channels (fcm/apns for
// android/ios/wearables) add rows with a different channel and the device token
// in `endpoint` — no schema change needed.
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  channel: text("channel").notNull().default("web_push"), // web_push | fcm | apns
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull().default(""), // web push public key
  auth: text("auth").notNull().default(""), // web push auth secret
  platform: text("platform").notNull().default("web"), // web | android | ios | wearable
  userAgent: text("user_agent").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
}, (table) => ({
  userIdx: index("push_subscriptions_user_idx").on(table.userId),
  endpointUnique: uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint),
}))

// ── Notification reminders (#6) ────────────────────────────────────────────────
// User-defined "remind me to add transactions" schedules. The worker-driven cron
// (POST /api/cron/notifications) materializes a reminder notification when a slot
// is due. `schedule` holds { times: ["09:00","18:00"], weekdays: [1..7], timezone }
// evaluated in the stored tz. `organization_id` is the org the reminder belongs to
// (so the deep-linked Add-Transaction opens in the right workspace); NULL = follow
// the user's active org. Delete-is-final.
export const notificationReminders = pgTable("notification_reminders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(), // owner (Clerk userId)
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  label: text("label").notNull(),
  // { times: string[] ("HH:mm"), weekdays: number[] (1=Mon..7=Sun), timezone: string }
  schedule: jsonb("schedule").notNull().default({}),
  lastFiredAt: timestamp("last_fired_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  userIdx: index("notification_reminders_user_idx").on(table.userId),
  // One reminder per (user, label) so the settings list stays clean.
  userLabelUnique: uniqueIndex("notification_reminders_user_label_unique").on(table.userId, table.label),
}))

// ── Admin broadcasts (#7) ──────────────────────────────────────────────────────
// Admin-composed notifications fanned out to an audience. `audience` =
// { type: 'all'|'push_enabled'|'users'|'group', userIds?: string[], groupId?: uuid }.
// `schedule` = { type: 'now'|'at'|'recurring', at?: ISO, recurring?: { freq, interval, until? } }.
// `importance=true` bypasses the recipient's category mute (always bells, attempts push).
// `link_type` = 'internal' (an app route) | 'external' (a full URL). `stats` accrues
// { delivered, push_sent } as the broadcast fans out. status: draft|scheduled|sending|sent|cancelled.
export const broadcasts = pgTable("broadcasts", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdBy: text("created_by").notNull(), // admin Clerk userId
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  imageUrl: text("image_url"), // optional hosted image URL (shown in push + bell)
  link: text("link"), // route (internal) or full URL (external) opened on click
  linkType: text("link_type").notNull().default("internal"), // internal | external
  category: text("category").notNull().default("system"),
  importance: boolean("importance").notNull().default(false),
  audience: jsonb("audience").notNull().default({}),
  schedule: jsonb("schedule").notNull().default({}),
  status: text("status").notNull().default("draft"), // draft|scheduled|sending|sent|cancelled
  nextFireAt: timestamp("next_fire_at"), // when the scheduler should next deliver it
  sentAt: timestamp("sent_at"),
  stats: jsonb("stats").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  createdByIdx: index("broadcasts_created_by_idx").on(table.createdBy, table.createdAt),
  // The scheduler's hot query: which scheduled broadcasts are due.
  dueIdx: index("broadcasts_due_idx").on(table.status, table.nextFireAt),
}))

// ── Saved user groups (#8) ─────────────────────────────────────────────────────
// Reusable broadcast audiences. A group + its members are owned by the admin who
// created it. Members are Clerk userIds (platform-wide, not org-scoped — broadcasts
// are a platform feature).
export const userGroups = pgTable("user_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(), // admin Clerk userId
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  ownerNameUnique: uniqueIndex("user_groups_owner_name_unique").on(table.createdBy, table.name),
}))

export const userGroupMembers = pgTable("user_group_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull().references(() => userGroups.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(), // member (Clerk userId)
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  groupIdx: index("user_group_members_group_idx").on(table.groupId),
  groupUserUnique: uniqueIndex("user_group_members_group_user_unique").on(table.groupId, table.userId),
}))
