import { pgTable, uuid, text, numeric, date, timestamp, integer, boolean, index, jsonb } from "drizzle-orm/pg-core"

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
  // The workspace's own/internal client — the company (or person) itself. Used to
  // record own expenses (rent, utilities, salaries). Exactly one per org; shown
  // first and badged distinctly in lists/pickers. Personal orgs use it as their
  // single hidden anchor client.
  isOwn: boolean("is_own").notNull().default(false),
  onboardDate: date("onboard_date"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("clients_org_idx").on(table.organizationId),
}))

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  description: text("description").default(""),
  category: text("category").default(""),
  date: date("date").notNull().defaultNow(),
  // Soft-delete: deleted transactions move to Trash (restore/purge) instead of
  // disappearing. All financial aggregates must exclude rows where this is set.
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})

export const quotations = pgTable("quotations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  organizationId: uuid("organization_id"),
  title: text("title").notNull(),
  prospectName: text("prospect_name").notNull(),
  company: text("company").default(""),
  email: text("email").default(""),
  phone: text("phone").default(""),
  amount: numeric("amount", { precision: 12, scale: 2 }).default("0"),
  status: text("status").default("draft"), // draft | sent | accepted | rejected
  notes: text("notes").default(""),
  linkedClientId: uuid("linked_client_id"), // set when converted to a client
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("quotations_org_idx").on(table.organizationId),
}))

export const transactionAttachments = pgTable("transaction_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size").notNull(),
  fileData: text("file_data").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
})

export const quotationAttachments = pgTable("quotation_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  quotationId: uuid("quotation_id").notNull().references(() => quotations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size").notNull(),
  fileData: text("file_data").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
})

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
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})

export const appAdmins = pgTable("app_admins", {
  userId: text("user_id").primaryKey(),
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
  provider: text("provider"), // dodo | stub | manual | null
  providerSubscriptionId: text("provider_subscription_id"),
  currentPeriodEnd: timestamp("current_period_end"),
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
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
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
}))
