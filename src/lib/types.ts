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
  tags?: string[]
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

// A "logical" category: all category rows sharing a name in an org, folded into
// one entry whose `types` is the set across those rows. This is the shape the
// Category & Tags manager works with (no schema change — see docs/cattags/PLAN.md).
export type CombinedCategory = {
  name: string
  color: string
  types: CategoryType[]
}

// Registry row for a tag (source of truth for the tag manager: stable color +
// rename target). Entities store the tag *string* in their own `tags` jsonb.
export type Tag = {
  id: string
  organization_id: string
  name: string
  color: string
  created_at: string
  updated_at: string
}

// One row from GET /api/tags: a registry tag merged with its live per-entity usage
// counts. `id` is null for an inline tag that exists on entities but has no registry
// row yet (materialize one via POST before editing/deleting it).
export type TagUsage = {
  id: string | null
  name: string
  color: string
  transactions: number
  clients: number
  quotations: number
  total: number
}

// The entity kinds a tag/category drilldown can surface.
export type TaggableEntityType = "transaction" | "client" | "quotation"

// One flattened row in a tag/category "show me every entity matching X"
// drilldown. Mirrors the server shape in api/_lib/entity-drilldown.ts.
export type DrilldownItem = {
  entity_type: TaggableEntityType
  id: string
  title: string
  subtitle: string
  amount: string | null
  tx_type: string | null // "incoming" | "outgoing" for transactions
  status: string | null
  date: string | null
  category: string
  tags: string[]
  link: string
}

export type DrilldownSort = "date_desc" | "date_asc" | "amount_desc" | "amount_asc" | "name_asc"

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
  wealth_account_type?: WealthAccountType | null
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
  wealth_account_type?: WealthAccountType | null
  wealth_account_icon?: string | null
  type: "incoming" | "outgoing"
  amount: number
  description: string
  category: string
  // User hashtags ("#business") — normalized by src/lib/transaction-tags.ts.
  tags?: string[]
  date: string
  is_system?: boolean
  // Set when this row was auto-created by a recurring rule (drives the
  // "Recurring" badge in lists + the detail modal).
  recurring_rule_id?: string | null
  // 'transfer' marks the two legs of an account-to-account move (shown only on
  // the account-detail list, never in the global list / analytics) — paying a
  // credit card is a transfer bank → card. 'refund' is an incoming that gives
  // money back for an earlier expense: reporting nets it against EXPENSE, never
  // income (src/lib/tx-classify.ts).
  kind?: "standard" | "transfer" | "refund"
  // For a transfer leg: the OTHER leg's account (id + type) — lets the UI badge a
  // transfer to/from a Space (or a card payment) and deep-link to it.
  counterpart_account_id?: string | null
  counterpart_type?: WealthAccountType | null
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

// `credit_card` is a LIABILITY account: `current_balance` stays the signed
// asset-equivalent value (normally NEGATIVE = amount owed). Never read the sign
// in a component — use cardDebt()/availableCredit() from src/lib/credit-card.ts.
export type WealthAccountType = "bank" | "cash" | "space" | "credit_card"

export type WealthAccount = {
  id: string
  organization_id: string
  type: WealthAccountType
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
  // Savings goal (type='space' only). The monthly-contribution suggestion +
  // progress are DERIVED (src/lib/spaces.ts), not stored.
  goal_amount?: number | null
  target_date?: string | null
  // Credit card configuration (type='credit_card' only; null otherwise). Owed /
  // available / statement figures are DERIVED (GET /api/wealth/accounts/:id/card).
  credit_limit?: number | string | null
  statement_closing_day?: number | null
  payment_due_day?: number | null
}

// One CLOSED billing cycle of a credit card, as returned by the card summary
// (statement_balance is the snapshot; paid/remaining/status are derived from
// the payments dated after closing_date — src/lib/credit-card.ts statementView).
export type CreditCardStatementView = {
  id: string
  cycle_start: string | null
  closing_date: string
  due_date: string
  source: "computed" | "manual" | string
  statementBalance: number
  paid: number
  remaining: number
  status: "unpaid" | "partial" | "paid" | "overdue"
  daysToDue: number
}

// GET /api/wealth/accounts/:id/card
export type CreditCardSummary = {
  account: WealthAccount
  usage: {
    debt: number
    credit: number
    limit: number | null
    available: number | null
    utilization: number | null
    overLimit: boolean
  }
  statement: CreditCardStatementView | null
  history: CreditCardStatementView[]
  cycle: {
    start: string
    closes_on: string
    next_due_date: string | null
    spent: number
    refunds: number
    payments: number
  }
}

export type RecurringRule = {
  id: string
  organization_id: string
  // NULL = the org's own/internal client (the personal org's anchor).
  client_id: string | null
  client_name?: string | null
  client_is_own?: boolean | null
  wealth_account_id: string | null
  account_name?: string | null
  // 'standard' = normal income/outgoing rule. 'transfer' = a Space auto-save:
  // money moves from `wealth_account_id` (source) to `to_account_id` (the Space).
  kind?: "standard" | "transfer"
  to_account_id?: string | null
  to_account_name?: string | null
  name: string
  type: "incoming" | "outgoing"
  amount: number | string
  category: string
  frequency_unit: "day" | "week" | "month" | "year"
  frequency_interval: number
  start_date: string
  end_date: string | null
  next_due_at: string
  active: boolean
  last_error: string
  generated_count?: number
  created_at: string
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
  tags?: string[]
  linked_client_id: string | null
  deleted_at: string | null
  closed_at?: string | null
  created_at: string
  updated_at: string
  attachment_count?: number
  // Generated-PDF state (see quotations schema). The object key is never a URL;
  // the app mints a short-lived presigned URL on each access.
  pdf_status?: "none" | "generating" | "ready" | "error"
  pdf_object_key?: string
  pdf_source_hash?: string
  pdf_size_bytes?: number
  pdf_generated_at?: string | null
  pdf_error?: string
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
  // Profile picture as a durable data: URL (built server-side from stored bytes).
  avatar_src?: string | null
  // Custom dashboard arrangement (see src/lib/dashboard-layout.ts).
  dashboard_layout?: unknown
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
export type PersonalFeature = "spaces" | "budget_plan"
export type GatedFeature = BusinessFeature | PersonalFeature

export function accountTypeAllows(
  accountType: AccountType | null | undefined,
  feature: GatedFeature,
): boolean {
  const isBusinessOnly = feature === "clients" || feature === "quotations" || feature === "members"
  // Personal-only sections (Spaces savings buckets). Legacy/unknown orgs are
  // treated as business, so Spaces show ONLY for an explicit personal account.
  // `budget_plan` is the Budget v2 household plan (periods, envelopes, safe to
  // spend). Business workspaces keep their per-client SPEND CAPS instead, which
  // are a different concept and are not gated — see spec §23. Adding it here is
  // what stops a business workspace creating a household plan it was never
  // meant to have.
  const isPersonalOnly = feature === "spaces" || feature === "budget_plan"
  // Unknown / legacy orgs default to the full (business) experience so we never
  // lock an existing user out of features they already use.
  if (isBusinessOnly && accountType === "personal") return false
  if (isPersonalOnly && accountType !== "personal") return false
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
  // Workspace logo as a durable data: URL (built server-side from stored bytes).
  logo_src?: string | null
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

// ── Notifications ─────────────────────────────────────────────────────────────
// API row shapes (snake_case, as returned by serialize()). The preference shape
// and the category/channel enums live in src/lib/notifications.ts (dependency-free,
// shared with the API + vitest). Named `AppNotification` to avoid colliding with
// the DOM `Notification` global.
export type NotificationData = {
  i18nKey?: string
  i18nParams?: Record<string, string | number>
  [key: string]: unknown
}

export type AppNotification = {
  id: string
  user_id: string
  organization_id: string | null
  type: string
  category: string
  title: string
  body: string
  data: NotificationData
  link: string | null
  actor_user_id: string | null
  client_id: string | null
  read_at: string | null
  created_at: string
}

export type NotificationListResponse = {
  notifications: AppNotification[]
  next_cursor: string | null
  unread_count: number
}

export type PushSubscriptionRow = {
  id: string
  user_id: string
  channel: string
  endpoint: string
  platform: string
  user_agent: string
  created_at: string
  last_seen_at: string
}

// ── Notification reminders (#6) ────────────────────────────────────────────────
// A user's "remind me to add transactions" schedule. `weekdays` use 1=Mon..7=Sun.
// `times` are "HH:mm" in the stored IANA `timezone`. An empty `weekdays` means
// every day.
export type ReminderSchedule = {
  times: string[]
  weekdays: number[]
  timezone: string
}
export type NotificationReminder = {
  id: string
  user_id: string
  organization_id: string | null
  enabled: boolean
  label: string
  schedule: ReminderSchedule
  last_fired_at: string | null
  created_at: string
  updated_at: string
}

// ── Admin broadcasts (#7) ──────────────────────────────────────────────────────
export type BroadcastAudience =
  | { type: "all" }
  | { type: "push_enabled" }
  | { type: "users"; userIds: string[] }
  | { type: "group"; groupId: string }
export type BroadcastRecurrence = {
  freq: "daily" | "weekly" | "monthly"
  interval: number
  until?: string | null
}
export type BroadcastSchedule =
  | { type: "now" }
  | { type: "at"; at: string }
  | { type: "recurring"; at: string; recurring: BroadcastRecurrence }
export type BroadcastStatus = "draft" | "scheduled" | "sending" | "sent" | "cancelled"
export type BroadcastStats = { delivered?: number; push_sent?: number }
export type Broadcast = {
  id: string
  created_by: string
  title: string
  body: string
  image_url: string | null
  link: string | null
  link_type: "internal" | "external"
  category: string
  importance: boolean
  audience: BroadcastAudience
  schedule: BroadcastSchedule
  status: BroadcastStatus
  next_fire_at: string | null
  sent_at: string | null
  stats: BroadcastStats
  created_at: string
  updated_at: string
}

// ── Saved user groups (#8) ─────────────────────────────────────────────────────
export type UserGroup = {
  id: string
  name: string
  created_by: string
  member_count: number
  created_at: string
  updated_at: string
}
export type UserGroupMember = {
  user_id: string
  email: string | null
  name: string | null
  avatar_url: string | null
}

// ── Budget v2 ────────────────────────────────────────────────────────────────
// Mirrors the GET /api/budgets/v2 payload (spec §11.3). Section shapes are
// deliberately DIFFERENT from one another: income/commitment/debt/savings are
// not commensurable with flexible spending, and collapsing them into one
// "spent of planned" ratio is the error §8.7 exists to prevent.

export type BudgetSectionName = "income" | "commitment" | "flexible" | "savings" | "debt"
export type BudgetStateV2 = "none" | "ok" | "warn" | "full" | "over"
/** Which limit produced safe-to-spend, so the UI can say WHY. */
export type SafeToSpendBinding = "cash" | "plan" | "both" | "cash_only"

export type BudgetEnvelopeView = {
  id: string
  name: string
  section: BudgetSectionName
  planned: number
  rollover_in: number
  authored_amount: number
  authored_cadence: "period" | "month" | "week" | "day"
  spent_gross: number
  refunds_confirmed: number
  refunds_provisional: number
  spent_net: number
  pending: number
  /** SIGNED — negative when this envelope is over. Cards show this, not the netted figure. */
  remaining: number
  state: BudgetStateV2
  priority: string
  carry_policy: string
  is_catch_all: boolean
  reimbursable: boolean
  funding_mode: "virtual" | "space_backed" | null
  auto_fund: boolean
  goal_amount: number | null
  target_date: string | null
  balance: number | null
  contribution_status: "planned" | "confirmed" | "missed" | "skipped" | null
  needs_attention: boolean
  excluded_occurrence_count: number
  /** Category keys this envelope claims. Empty for the catch-all. */
  match_keys: string[]
  /** Icon key; empty means "derive from the section". */
  icon: string
  /**
   * Goal progress for a savings fund, or null when it has no goal.
   * Computed with the Spaces goal math, reused unchanged (spec §8.9).
   */
  goal_progress: { pct: number; remaining: number; reached: boolean } | null
  /** Rises when a contribution is missed, so a fund tells the truth about being behind. */
  suggested_monthly: number | null
  /** Occurrence money settled inside this period (commitment and debt). */
  settled: number
  overdue_count: number
  overdue_amount: number
}

export type BudgetOccurrenceAction = "settle" | "cancel" | "skip" | "reschedule"

export type BudgetOccurrenceView = {
  commitment_id: string
  /** The commitment's name — an overdue row without it cannot be acted on. */
  name: string
  kind: string
  needs_attention: boolean
  envelope_id: string
  due_date: string
  amount: number
  state: string
  overdue: boolean
  days_overdue?: number
  from_previous_period?: boolean
  /** Which actions the server will accept for this occurrence's current state. */
  actions: BudgetOccurrenceAction[]
}

/** A machine-readable limitation. Never a converted figure (spec §12.2). */
export type BudgetCurrencyLimitation = {
  code: "currency_mismatch"
  plan_currency: string
  org_currency: string
  converted: false
}

/** One inflow that currently nets against an envelope only by category match. */
export type BudgetProvisionalRefund = {
  transaction_id: string
  date: string
  amount: number
  category: string | null
  description: string | null
  envelope: { id: string; name: string } | null
}

/** One entry in a virtual fund's ledger. */
export type BudgetFundEntry = {
  id: string
  envelope_id: string
  period_id: string | null
  kind: "contribution" | "withdrawal" | "adjustment"
  amount: string
  source: "confirmed" | "auto_fund" | "manual" | "conversion"
  note: string
  created_at: string
}

export type BudgetCommitmentView = {
  id: string
  envelope_id: string
  kind: "one_time" | "recurring"
  name: string
  amount: string
  due_date: string | null
  recurring_rule_id: string | null
  first_due_date: string
  status: string
  needs_attention: boolean
  rule: {
    name: string | null
    active: boolean
    missing: boolean
    next_due_at: string | null
    frequency_unit: string | null
    frequency_interval: number | null
    end_date: string | null
  } | null
}

export type BudgetView = {
  plan: {
    id: string
    status: "active" | "paused" | "archived"
    cadence: "monthly" | "weekly" | "payday" | "custom"
    timezone: string
    income_mode: "expected" | "available"
    expected_income: number | null
    currency: string
    next_period_seed: string
    paused_at: string | null
    updated_at: string | null
  } | null
  period: {
    id: string
    start: string
    end_exclusive: string
    status: "open" | "closed"
    is_partial: boolean
    days_left: number
    funding_base: number
    funding_base_source: string
    funding_base_anchor_date: string
    funding_base_as_of: string | null
    income_accreted: number
    funding_adjustments: number
    funding_capacity: number
  } | null
  money: {
    available_now: number
    reserved: number
    reserved_breakdown: {
      commitments_outstanding: number
      commitments_overdue: number
      debt_outstanding: number
      virtual_fund_balances: number
      virtual_contributions_unconfirmed: number
      space_contributions_due: number
      protected_savings_due: number
    }
    cash_after_reservations: number
    /** max(0, Σ planned − Σ spent_net − Σ pending) — netted, then floored ONCE. */
    flexible_headroom: number
    ceiling_defined: boolean
    safe_to_spend: number
    binding: SafeToSpendBinding
    unallocated: number
    unallocated_available: number
    forecast_balance: number
  } | null
  sections: {
    income: { expected: number | null; received: number; outstanding: number | null }
    flexible: {
      planned: number
      spent_gross: number
      refunds_confirmed: number
      refunds_provisional: number
      spent_net: number
      pending: number
      /** SIGNED. `headroom` is the floored value used in the min(). */
      remaining: number
      headroom: number
      utilisation: BudgetStateV2
      envelope_count: number
      overspent_count: number
      /** Outflow that matched no explicit envelope, i.e. what the catch-all absorbed. */
      uncategorised: number
      envelopes: BudgetEnvelopeView[]
    }
    commitment: {
      planned: number
      settled: number
      outstanding: number
      overdue: number
      overdue_count: number
      needs_attention_count: number
      envelopes: BudgetEnvelopeView[]
    }
    debt: {
      planned: number
      paid: number
      outstanding: number
      overdue: number
      overdue_count: number
      needs_attention_count: number
      envelopes: BudgetEnvelopeView[]
    }
    savings: {
      planned: number
      reserved: number
      funded: number
      funded_cash: number
      missed: number
      outstanding: number
      balance: number
      awaiting_confirmation: number
      skipped_count: number
      behind_count: number
      envelopes: BudgetEnvelopeView[]
    }
  } | null
  /** Identically the FLEXIBLE section's utilisation — never a cross-section ratio. */
  plan_status: BudgetStateV2 | null
  total_outflow: number | null
  occurrences_upcoming: BudgetOccurrenceView[]
  occurrences_overdue: BudgetOccurrenceView[]
  /** The read told us it is stale; resolve with POST /api/budgets/v2/sync. */
  sync_required: boolean
  alerts: { kind: string; envelope_id?: string; amount?: number }[]
  suggestions: { kind: string; envelope_id?: string; amount?: number | null; basis?: string }[]
  currency_limitation?: BudgetCurrencyLimitation | null
  /**
   * Questions the MIGRATION deliberately did not answer (spec §13.4, §13.8).
   * Absent for any plan created natively in v2.
   */
  prompts?: {
    /** A v1 `lifetime` budget: no monthly equivalent, so the user chooses. */
    lifetime_choice: { amount: number } | null
    /** The catch-all target is within 5% of median monthly income. */
    salary_vs_target: { target: number; median_income: number } | null
  }
  capabilities: { can_write: boolean; can_close: boolean; account_type: string | null }
  /** Machine-readable honesty about what this build cannot do (§21.4). */
  limitations: string[]
}
