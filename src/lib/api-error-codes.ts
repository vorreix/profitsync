// A server refusal, said in the reader's language.
//
// Every refusal the API sends is `{ error, code, ...params }`: `error` is an
// English sentence for logs and pinned old builds, `code` is the stable thing a
// client may act on. Showing `error` put English toasts in front of every
// German, Malayalam and Arabic user — about thirty call sites and every
// multi-currency refusal (MC-063). So the message comes from `code`:
//
//   1. an explicit entry below, for a code whose words already live elsewhere
//      (a card-wizard field, a delete-account step, a budget rule) or that
//      depends on a param (`reason`, `currency`, `attempts_left`);
//   2. otherwise `apiErrors.<code>` — the one section of the locale files that
//      exists for this;
//   3. otherwise `wealth.cardWizard.errors.<code>` (the card field codes).
//
// An unmapped refusal falls back to the caller's translated line. Its English
// `error` is shown only to someone reading English, which is exactly who it was
// written for — so an English workspace reads as specific as it always did.
// The same holds for a code that covers several sentences the translation
// can't tell apart (`generic`): English keeps the server's specific one.
//
// `src/lib/api-error-codes.test.ts` scans api/ for every code it can send and
// fails when one has no translation.
import i18n from "i18next"

/** The JSON body a refused API call carries. */
export type ApiErrorBody = { error?: unknown; reason?: unknown; code?: unknown; [key: string]: unknown }

/**
 * `generic`: the translation is vaguer than the server's sentence (one code,
 * several meanings, a figure the body doesn't carry) — so English readers keep
 * the sentence and only everyone else gets the translation.
 */
type Resolved = { key: string; params?: Record<string, unknown>; generic?: boolean }
type Resolver = string | ((body: ApiErrorBody) => string | Resolved)

/**
 * The account-currency lock reasons the server sends with
 * `account_currency_locked` (src/lib/account-currency-lock.ts), each with the
 * line the Edit dialog already shows for it.
 */
export const ACCOUNT_CURRENCY_LOCK_KEYS: Record<string, string> = {
  history: "wealth.accountCurrencyLocked",
  balance: "wealth.accountCurrencyLockedBalance",
  recurring: "wealth.accountCurrencyLockedRecurring",
  card: "wealth.accountCurrencyLockedCards",
  transfer: "wealth.accountCurrencyLockedTransfer",
  configured: "wealth.accountCurrencyLockedConfigured",
}

const detail = (b: ApiErrorBody): Record<string, unknown> =>
  b.detail && typeof b.detail === "object" ? (b.detail as Record<string, unknown>) : {}

const generic = (key: string): Resolved => ({ key, generic: true })
const named = (v: unknown): v is string => typeof v === "string" && v !== ""

const RESOLVERS: Record<string, Resolver> = {
  // An account names its reason; a card's 409 carries none. A legacy account
  // has no currency to name, and a line that says "{{currency}}" would print
  // the placeholder — so it gets the line that names none.
  account_currency_locked: (b) => {
    const key = typeof b.reason === "string" ? ACCOUNT_CURRENCY_LOCK_KEYS[b.reason] : undefined
    if (!key) return "wealth.cardWizard.errors.account_currency_locked"
    return named(b.currency) || !i18n.t(key).includes("{{") ? key : "apiErrors.account_currency_locked"
  },
  // A budget or cap says which currency it is kept in, a debt which currency
  // pays it (`context: "debt"`). Without one the server's sentences differ
  // (a debt's payer, borrowed money, a stale copy) and ours can't say which.
  currency_mismatch: (b) =>
    named(b.currency) ? (b.context === "debt" ? "apiErrors.currency_mismatch_debt" : "apiErrors.currency_mismatch_in") : generic("apiErrors.currency_mismatch"),
  // One code, several sentences ("no referral earnings in that currency",
  // "Invalid transfer currency"); the minimum payout names its figure; a
  // personal-account refusal names the feature.
  invalid_currency: () => generic("apiErrors.invalid_currency"),
  below_min_payout: () => generic("apiErrors.below_min_payout"),
  personal_account_restricted: () => generic("apiErrors.personal_account_restricted"),
  // Account deletion — the dialog's own lines.
  invalid_code: (b) => ({ key: "deleteAccount.invalidCode", params: { count: Number(b.attempts_left ?? 0) } }),
  expired: "deleteAccount.expiredCode",
  too_many_attempts: "deleteAccount.tooManyAttempts",
  email_unavailable: "deleteAccount.unavailable",
  email_send_failed: "deleteAccount.emailFailed",
  clerk_delete_failed: "deleteAccount.failed",
  // Spending budgets answer with the code AS `error` (and `detail`).
  name_taken: "budgets.errors.nameTaken",
  name_required: "budgets.errors.nameRequired",
  sub_budget_needs_categories: "budgets.errors.subNeedsCategories",
  categories_outside_parent: "budgets.errors.categoriesOutsideParent",
  has_sub_budgets: "budgets.errors.hasSubBudgets",
  too_many_budgets: "budgets.errors.tooMany",
  too_many_sub_budgets: "budgets.errors.tooMany",
  // A budget save sends the clash in `detail` (`by`); a category rename sends
  // it at the top level, naming the two sub-budgets it would collide (`a`, `b`)
  // — the same two shapes budgetErrorMessage reads.
  category_claimed: (b) => {
    const d = { ...b, ...detail(b) }
    const categories = Array.isArray(d.categories) ? d.categories.join(", ") : ""
    if (named(d.a)) return { key: "budgets.errors.renameClash", params: { categories, a: d.a, b: d.b ?? "" } }
    return { key: "budgets.errors.categoryClaimed", params: { categories, name: d.by ?? "" } }
  },
  // The overall budget may have no name.
  overall_exists: (b) => ({ key: "budgets.errors.overallExists", params: { name: detail(b).by || i18n.t("budgets.overall") } }),
  child_outside_scope: (b) => ({ key: "budgets.errors.childOutsideScope", params: { child: detail(b).child ?? "" } }),
}

const KEY_PREFIXES = ["apiErrors.", "wealth.cardWizard.errors."]

// Some handlers send the code itself as `error` ("name_taken", "unparseable").
// A bare token like that is a code, never a sentence to show.
const CODE_TOKEN = /^[a-z][a-z0-9_]*$/

// i18next reads these from the options object; a body field with the same
// name must never steer the translation.
const RESERVED_PARAMS = new Set(["lng", "lngs", "ns", "context", "count", "defaultValue", "returnObjects", "returnDetails", "joinArrays", "postProcess", "interpolation", "replace", "keySeparator", "nsSeparator"])

/** The JSON body of a thrown API error (`request` throws the raw body text), or null. */
export function apiErrorBody(err: unknown): ApiErrorBody | null {
  if (!(err instanceof Error)) return null
  const m = err.message.trim()
  if (!m.startsWith("{")) return null
  try {
    const body = JSON.parse(m) as unknown
    return body && typeof body === "object" && !Array.isArray(body) ? (body as ApiErrorBody) : null
  } catch {
    return null
  }
}

/** The stable code of a refusal — `code`, or a bare token sent as `error` — or null. */
export function apiErrorCode(err: unknown): string | null {
  return codeOf(apiErrorBody(err))
}

function codeOf(body: ApiErrorBody | null): string | null {
  if (!body) return null
  if (typeof body.code === "string" && body.code) return body.code
  return typeof body.error === "string" && CODE_TOKEN.test(body.error) ? body.error : null
}

// With the params, so a plural key (`deleteAccount.invalidCode_one`) is found by its base name.
const has = (key: string, params?: Record<string, unknown>) => i18n.isInitialized && i18n.exists(key, params)

/**
 * The i18n key (+ params) for a refusal body, or null when it has no
 * translation. Pure lookup — exported so the scan test can prove every code
 * the API sends resolves.
 */
export function apiErrorKey(body: ApiErrorBody | null): Resolved | null {
  const code = codeOf(body)
  if (code && body) {
    const resolver = RESOLVERS[code]
    if (resolver) {
      const r = typeof resolver === "string" ? { key: resolver } : resolver(body)
      const resolved = typeof r === "string" ? { key: r } : r
      if (has(resolved.key, resolved.params)) return resolved
    }
    for (const prefix of KEY_PREFIXES) if (has(prefix + code)) return { key: prefix + code }
  }
  // A plan limit (402: `{ allowed: false, reason, limit, upgradeHint }`) has no
  // code; its sentence names the limit, so it is the generic fallback below.
  if (body && body.allowed === false && body.reason !== undefined) {
    return { key: body.upgradeHint === true ? "apiErrors.plan_limit_upgrade" : "apiErrors.plan_limit" }
  }
  return null
}

function paramsOf(body: ApiErrorBody, extra?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (RESERVED_PARAMS.has(k)) continue
    if (typeof v === "string" || typeof v === "number") out[k] = v
  }
  return { ...out, ...extra }
}

const readsEnglish = () => !i18n.isInitialized || (i18n.language ?? "en").toLowerCase().startsWith("en")

/**
 * Turn a thrown API error into a message in the reader's language.
 *
 *   apiErrorMessage(err, t("wealth.transferFailed"))
 *
 * A known code → its translation, filled from the body's params (`currency`,
 * `reason`, …). Anything else → `fallback`, except that an English reader
 * still gets the server's own specific English sentence. Never raw JSON, never
 * a stack, never "Failed to fetch".
 */
export function translateApiError(err: unknown, fallback: string): string {
  const body = apiErrorBody(err)
  if (!body) return fallback
  const plan = body.allowed === false && body.reason !== undefined
  const text = typeof body.reason === "string" ? body.reason : typeof body.error === "string" ? body.error : ""
  // A plan limit's own sentence is more specific than our generic one ("10
  // clients"), and it is English — so English readers keep it.
  if (plan && text && readsEnglish()) return text
  const sentence = text && !CODE_TOKEN.test(text) && readsEnglish() ? text : null
  const resolved = apiErrorKey(body)
  if (resolved) {
    if (resolved.generic && sentence) return sentence
    const out = i18n.t(resolved.key, paramsOf(body, resolved.params) as Record<string, string>)
    // A param the body didn't carry leaves "{{x}}" behind — never show that.
    if (typeof out === "string" && out && out !== resolved.key && !out.includes("{{")) return out
  }
  return sentence ?? fallback
}
