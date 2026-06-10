export type Client = {
  id: string
  user_id: string
  organization_id?: string | null
  name: string
  company: string
  email: string
  phone: string
  status: "active" | "inactive" | "archived"
  notes: string
  category?: string
  is_own?: boolean
  onboard_date?: string | null
  deleted_at: string | null
  closed_at?: string | null
  created_at: string
  updated_at: string
  total_incoming?: number
  total_outgoing?: number
  attachment_count?: number
}

export type CategoryType = "incoming" | "outgoing" | "client" | "quotation"

export type Category = {
  id: string
  organization_id: string
  name: string
  type: CategoryType
  color: string
  created_at: string
  updated_at: string
}

// Editable metadata shared by all attachment kinds (see the attachment tables).
export type AttachmentMeta = {
  display_name?: string | null
  tags?: string[]
  category?: string
  updated_at?: string
}

export type TransactionAttachment = AttachmentMeta & {
  id: string
  transaction_id: string
  user_id: string
  file_name: string
  file_type: string
  file_size: number
  created_at: string
}

export type QuotationAttachment = AttachmentMeta & {
  id: string
  quotation_id: string
  user_id: string
  file_name: string
  file_type: string
  file_size: number
  created_at: string
}

export type ClientAttachment = AttachmentMeta & {
  id: string
  client_id: string
  user_id: string
  file_name: string
  file_type: string
  file_size: number
  created_at: string
}

// One account-leg of a transaction. A normal transaction has a single leg; a
// "split" transaction (€100 paid €30 cash + €25 AC1 + €45 AC2) has one leg per
// account, all sharing the same `group_id`. The list collapses a group into one
// representative `Transaction` row (amount = sum of legs); the detail view loads
// the individual legs.
export type TransactionLeg = {
  id: string
  wealth_account_id: string | null
  wealth_account_name?: string | null
  wealth_account_bank_name?: string | null
  wealth_account_type?: "bank" | "cash" | null
  wealth_account_icon?: string | null
  type: "incoming" | "outgoing"
  amount: number
}

export type Transaction = {
  id: string
  client_id: string
  client_name?: string
  wealth_account_id?: string | null
  wealth_account_name?: string | null
  wealth_account_bank_name?: string | null
  wealth_account_type?: "bank" | "cash" | null
  wealth_account_icon?: string | null
  type: "incoming" | "outgoing"
  amount: number
  description: string
  category: string
  date: string
  is_system?: boolean
  // 'transfer' marks the two legs of an account-to-account move (shown only on
  // the account-detail list, never in the global list / analytics).
  kind?: "standard" | "transfer"
  created_at: string
  updated_at: string
  attachment_count?: number
  // Split/group metadata. `group_id` links the legs of one logical transaction;
  // `leg_count`/`account_count` describe a collapsed grouped row (both default to
  // 1 for a normal single-account transaction). `legs` is loaded on demand for
  // the detail breakdown.
  group_id?: string | null
  leg_count?: number
  account_count?: number
  legs?: TransactionLeg[]
}

export type WealthAccount = {
  id: string
  organization_id: string
  type: "bank" | "cash"
  bank_name: string
  nickname: string
  opening_balance: number
  current_balance: number
  icon: string
  // Brand + banking details (see migration 0027). `logo_data` (base64) is stored
  // server-side; responses expose it as `logo_src` (a durable data: URL) which
  // the UI prefers over the expiring hotlinked `logo_url`.
  brand_domain?: string
  logo_url?: string
  logo_src?: string | null
  country?: string
  account_number?: string
  routing_number?: string
  swift?: string
  address?: string
  location?: string
  note?: string
  position?: number
  // Exactly one ACTIVE account per org can be the default (preselected in
  // transaction forms, badged in lists).
  is_default?: boolean
  archived_at: string | null
  created_at: string
  updated_at: string
  transaction_count?: number
  attachment_count?: number
}

export type WealthAccountAttachment = AttachmentMeta & {
  id: string
  wealth_account_id: string
  user_id: string
  file_name: string
  file_type: string
  file_size: number
  created_at: string
}

export type Quotation = {
  id: string
  user_id: string
  organization_id?: string | null
  title: string
  prospect_name: string
  company: string
  email: string
  phone: string
  amount: string
  date: string
  status: "draft" | "sent" | "accepted" | "rejected"
  notes: string
  category?: string
  linked_client_id: string | null
  deleted_at: string | null
  closed_at?: string | null
  created_at: string
  updated_at: string
  attachment_count?: number
}

// An expense (outgoing) budget. `client_id` null = the org-level budget (the
// personal budget for a personal org, or the default-for-clients template for a
// business org). `spent` is server-computed for the budget's current period
// (null for the business default, which is a template, not a single number).
export type Budget = {
  id: string
  organization_id: string
  client_id: string | null
  period: "lifetime" | "monthly" | "weekly" | "daily"
  amount: number
  spent: number | null
  created_at?: string
  updated_at?: string
}

export type UserProfile = {
  id: string
  email: string
  full_name: string
  currency: string
  language: string
  current_organization_id: string | null
  terms_accepted_at: string | null
  onboarded_at: string | null
  company_upsell_dismissed_at: string | null
  company_upsell_hidden: boolean
  address?: string
  city?: string
  state?: string
  postal_code?: string
  country?: string
  phone_country_code?: string
  phone?: string
  created_at: string
  updated_at: string
}

export type OrgRole = "owner" | "admin" | "editor" | "viewer"

/**
 * The feature tier a workspace was set up for. Chosen during onboarding and
 * stored on the organization. Drives feature gating across UI and API:
 *   - personal: solo finance tracking — no Clients, Quotations, or members
 *   - business: full experience
 */
export type AccountType = "personal" | "business"

export const ACCOUNT_TYPES: AccountType[] = ["personal", "business"]

/**
 * Single source of truth for which sections an account type can access.
 * Enforced in the UI (nav + route guards) and on the server (API authz).
 */
export type BusinessFeature = "clients" | "quotations" | "members"

export function accountTypeAllows(
  accountType: AccountType | null | undefined,
  feature: BusinessFeature,
): boolean {
  const isBusinessOnly = feature === "clients" || feature === "quotations" || feature === "members"
  // Unknown / legacy orgs default to the full (business) experience so we never
  // lock an existing user out of features they already use.
  if (isBusinessOnly && accountType === "personal") return false
  return true
}

export type Organization = {
  id: string
  owner_user_id: string
  name: string
  slug: string
  is_personal: boolean
  account_type: AccountType | null
  currency: string
  role: OrgRole
  plan_key: string | null
  plan_status: string | null
  created_at: string
  updated_at: string
}

/**
 * True when a plan key represents a paid (Pro) tier. The shared free tier is the
 * only non-paid key; everything else (`personal`, `business`, legacy `premium`)
 * is paid. Use this everywhere instead of comparing against a specific key so the
 * UI stays correct as plan keys evolve.
 */
export function isPaidPlanKey(key: string | null | undefined): boolean {
  return !!key && key !== "free"
}

export const CURRENCIES = [
  "USD", "EUR", "GBP", "CAD", "AUD", "JPY",
  "INR", "CHF", "CNY", "SEK", "NZD",
]

export const LEGAL_DOC_VERSION = "1.0.0"

// ── Blog ─────────────────────────────────────────────────────────────────────
export type BlogStatus = "draft" | "published"
export const BLOG_STATUSES: BlogStatus[] = ["draft", "published"]

/**
 * A platform blog post (admin-authored, shown on the public marketing site).
 * Not org-scoped. `content` is Markdown. `reading_time_minutes` is computed by the
 * API and only present on responses, never stored. Public list responses omit
 * `content` (it's only returned by the single-post endpoint and the admin API).
 */
export type BlogPost = {
  id: string
  slug: string
  title: string
  excerpt: string
  content: string
  cover_image_url: string
  tags: string[]
  author_name: string
  author_user_id: string | null
  // Author E-E-A-T signals — surfaced as a visible byline + schema.org Person.
  author_job_title: string
  author_bio: string
  author_url: string
  author_image_url: string
  // Dedicated 1200×630 social card (falls back to cover image, then site default).
  og_image_url: string
  // Topic-cluster / pillar (e.g. "Cash Flow") → schema articleSection + grouping.
  article_section: string
  status: BlogStatus
  seo_title: string
  seo_description: string
  published_at: string | null
  created_at: string
  updated_at: string
  reading_time_minutes?: number
}

// Lightweight shape returned by the public list endpoint (no `content`, no SEO
// overrides, no long-form author bio).
export type BlogPostSummary = Omit<
  BlogPost,
  "content" | "author_user_id" | "seo_title" | "seo_description" | "author_bio"
>
