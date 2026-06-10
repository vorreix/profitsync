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
  type: text("type").notNull(), // bank | cash
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
  // User-defined card order within the org (lower = earlier). Set via the
  // drag-to-reorder UI; ties fall back to createdAt so pre-existing rows keep
  // their original order until first reordered.
  position: integer("position").notNull().default(0),
  archivedAt: timestamp("archived_at"),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("wealth_accounts_org_idx").on(table.organizationId),
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
  // Soft-delete: deleted transactions move to Trash (restore/purge) instead of
  // disappearing. All financial aggregates must exclude rows where this is set.
  deletedAt: timestamp("deleted_at"),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  groupIdx: index("transactions_group_idx").on(table.groupId),
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
  role: text("role").notNull().default("super_admin"), // super_admin | editor | viewer | blog_writer
  createdAt: timestamp("created_at").defaultNow(),
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
