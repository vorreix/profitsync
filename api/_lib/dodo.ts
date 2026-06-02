import { createHmac, timingSafeEqual } from "crypto"

/**
 * Dodo Payments client (Merchant of Record).
 *
 * Every call is scoped to a `DodoEnv` ("test" | "live") passed by the caller —
 * test and live are fully separate datastores with separate API keys, so the
 * environment is a per-plan property (see plans.dodo_environment), not a single
 * deployment-wide constant. baseFor/keyFor/webhookSecretFor resolve the right
 * endpoint + credential per env, falling back to the legacy single
 * DODO_PAYMENTS_API_KEY / DODO_PAYMENTS_WEBHOOK_SECRET for backward compatibility.
 *
 * We use the Subscriptions API with `payment_link: true`, which returns a hosted
 * checkout URL. Dodo's hosted page collects the customer's full billing address
 * and payment method, computes tax (MoR), and supports global payment methods.
 */

/** A Dodo Payments environment. Each is a fully separate datastore + key. */
export type DodoEnv = "test" | "live"

/**
 * The deployment's default Dodo environment, from DODO_PAYMENTS_ENVIRONMENT
 * (defaults to test). Two uses:
 *  - backward-compat fallback for the legacy single DODO_PAYMENTS_API_KEY /
 *    DODO_PAYMENTS_WEBHOOK_SECRET vars (which env they belong to), and
 *  - the fallback env for legacy subscription rows whose dodo_environment is
 *    null (created before per-plan environments existed) — safer than a
 *    hardcoded "live", which would be wrong on a test_mode deployment.
 * Read at call time so tests (and env changes) take effect without reloading.
 */
export function defaultDodoEnv(): DodoEnv {
  return (process.env.DODO_PAYMENTS_ENVIRONMENT || "test_mode").toLowerCase() === "live_mode" ? "live" : "test"
}

function baseFor(env: DodoEnv): string {
  return env === "live" ? "https://live.dodopayments.com" : "https://test.dodopayments.com"
}

/** Resolve the API key for an env, falling back to the legacy single key. */
function keyFor(env: DodoEnv): string | undefined {
  const explicit = env === "live" ? process.env.DODO_PAYMENTS_API_KEY_LIVE : process.env.DODO_PAYMENTS_API_KEY_TEST
  if (explicit) return explicit
  if (env === defaultDodoEnv()) return process.env.DODO_PAYMENTS_API_KEY
  return undefined
}

/** Resolve the webhook signing secret for an env, falling back to the legacy one. */
function webhookSecretFor(env: DodoEnv): string | undefined {
  const explicit =
    env === "live" ? process.env.DODO_PAYMENTS_WEBHOOK_SECRET_LIVE : process.env.DODO_PAYMENTS_WEBHOOK_SECRET_TEST
  if (explicit) return explicit
  if (env === defaultDodoEnv()) return process.env.DODO_PAYMENTS_WEBHOOK_SECRET
  return undefined
}

/** True when an API key is configured for the given environment. */
export function isDodoConfigured(env: DodoEnv): boolean {
  return !!keyFor(env)
}

function authHeader(env: DodoEnv): string {
  const key = keyFor(env)
  if (!key) throw new Error(`DODO_PAYMENTS_API_KEY not configured for ${env} environment`)
  return `Bearer ${key}`
}

async function call<T>(path: string, env: DodoEnv, init: RequestInit = {}): Promise<T> {
  const res = await fetch(baseFor(env) + path, {
    ...init,
    headers: {
      Authorization: authHeader(env),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Dodo ${res.status}: ${text}`)
  }
  return (text ? JSON.parse(text) : {}) as T
}

export type DodoBilling = {
  country: string
  state?: string
  city?: string
  street?: string
  zipcode?: string
}

export type DodoCustomerRef =
  | { customer_id: string }
  | { email: string; name: string }

export type DodoCreateSubscriptionResult = {
  subscription_id: string
  payment_link: string
  client_secret: string
  payment_id: string
  expires_on: string
  recurring_pre_tax_amount: number
  customer: { customer_id: string; email: string; name: string }
  metadata: Record<string, string>
}

/** A plan change Dodo has scheduled for a future billing date. */
export type DodoScheduledChange = {
  id?: string
  product_id: string
  product_name?: string | null
  quantity?: number
  effective_at: string
} | null

export type DodoSubscription = {
  subscription_id: string
  status: string // pending | active | on_hold | cancelled | expired | failed
  product_id: string
  currency: string
  recurring_pre_tax_amount: number
  created_at?: string | null
  next_billing_date: string | null
  previous_billing_date: string | null
  cancelled_at: string | null
  cancel_at_next_billing_date: boolean
  scheduled_change?: DodoScheduledChange
  customer: { customer_id: string; email: string; name: string }
  metadata: Record<string, string>
}

/** A Dodo payment (one charge). `total_amount` is in minor units (e.g. cents). */
export type DodoPayment = {
  payment_id: string
  status: string // succeeded | processing | failed | cancelled | requires_*
  total_amount: number
  currency: string
  created_at: string
  subscription_id: string | null
  invoice_id?: string | null
  invoice_url?: string | null
  metadata?: Record<string, string>
}

/**
 * Create a subscription and return a hosted checkout link to redirect the user to.
 * `customer` + `billing` are required by the API; the hosted page lets the buyer
 * confirm/complete their billing address, so a country seed is enough.
 */
export async function createSubscription(input: {
  productId: string
  quantity?: number
  customer: DodoCustomerRef
  billing: DodoBilling
  returnUrl: string
  metadata?: Record<string, string>
  env: DodoEnv
}): Promise<DodoCreateSubscriptionResult> {
  return call<DodoCreateSubscriptionResult>("/subscriptions", input.env, {
    method: "POST",
    body: JSON.stringify({
      product_id: input.productId,
      quantity: input.quantity ?? 1,
      payment_link: true,
      return_url: input.returnUrl,
      customer: input.customer,
      billing: {
        country: input.billing.country,
        state: input.billing.state ?? "",
        city: input.billing.city ?? "",
        street: input.billing.street ?? "",
        zipcode: input.billing.zipcode ?? "",
      },
      metadata: input.metadata ?? {},
    }),
  })
}

export async function getSubscription(subscriptionId: string, env: DodoEnv): Promise<DodoSubscription> {
  return call<DodoSubscription>(`/subscriptions/${subscriptionId}`, env)
}

/**
 * List the payments (charges) Dodo recorded for one subscription, newest first.
 * Used to populate invoice history directly (the webhook is best-effort and may
 * not be configured for every environment). `GET /payments?subscription_id=`.
 */
export async function listPayments(subscriptionId: string, env: DodoEnv): Promise<DodoPayment[]> {
  const res = await call<{ items?: DodoPayment[] }>(
    `/payments?subscription_id=${encodeURIComponent(subscriptionId)}&page_size=100`,
    env,
  )
  return res.items ?? []
}

export type DodoProrationMode =
  | "prorated_immediately"
  | "full_immediately"
  | "difference_immediately"
  | "do_not_bill"

/**
 * Change a subscription's plan (e.g. monthly → yearly). With
 * `effectiveAt: "next_billing_date"` the customer keeps their current plan until
 * the period ends, then the new plan/price takes effect — no charge today. The
 * pending change is reported back on the subscription's `scheduled_change`.
 */
export async function changePlan(input: {
  subscriptionId: string
  productId: string
  quantity?: number
  prorationBillingMode: DodoProrationMode
  effectiveAt?: "immediately" | "next_billing_date"
  metadata?: Record<string, string>
  env: DodoEnv
}): Promise<DodoSubscription> {
  return call<DodoSubscription>(`/subscriptions/${input.subscriptionId}/change-plan`, input.env, {
    method: "POST",
    body: JSON.stringify({
      product_id: input.productId,
      quantity: input.quantity ?? 1,
      proration_billing_mode: input.prorationBillingMode,
      effective_at: input.effectiveAt ?? "immediately",
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }),
  })
}

/**
 * Download the invoice PDF Dodo generates for a successful payment.
 * Endpoint: GET /invoices/payments/{payment_id} → application/pdf binary.
 * Returns the raw bytes so the caller can stream them to the browser (we never
 * expose the Dodo API key to the client).
 */
export async function fetchInvoicePdf(paymentId: string, env: DodoEnv): Promise<Buffer> {
  const res = await fetch(`${baseFor(env)}/invoices/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: authHeader(env), Accept: "application/pdf" },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Dodo invoice ${res.status}: ${text}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

export type DodoPriceDetail = {
  price: number // minor units (e.g. cents)
  currency: string
  discount?: number // percentage off the list price (0-100)
  tax_inclusive?: boolean
  trial_period_days?: number
  payment_frequency_interval?: string // "Month" | "Year"
  payment_frequency_count?: number
}

export type DodoProduct = {
  product_id: string
  name: string | null
  description: string | null
  is_recurring: boolean
  // GET /products/{id} returns `price` as an object; some list shapes use a number.
  price: DodoPriceDetail | number
  currency?: string
  image?: string | null
  tax_category?: string | null
  metadata?: Record<string, string> | null
}

/** Fetch a single Dodo product (used to derive plan name / price / interval). */
export async function getProduct(productId: string, env: DodoEnv): Promise<DodoProduct> {
  return call<DodoProduct>(`/products/${encodeURIComponent(productId)}`, env)
}

/** Everything we can derive about a plan cycle from a single Dodo product. */
export type DerivedProduct = {
  productId: string
  name: string
  description: string
  minor: number // list price in minor units (cents)
  currency: string
  discountPct: number // percentage off (0-100)
  interval: "monthly" | "yearly" | null
  trialDays: number
  recurring: boolean
  image: string | null
  taxCategory: string | null
  metadata: Record<string, string>
}

/** Normalize a Dodo product into the fields we sync onto a plan. */
export function priceFromProduct(product: DodoProduct): DerivedProduct {
  const detail = typeof product.price === "object" ? product.price : null
  const minor = detail ? detail.price : (typeof product.price === "number" ? product.price : 0)
  const currency = detail?.currency ?? product.currency ?? "USD"
  const rawInterval = detail?.payment_frequency_interval?.toLowerCase()
  const interval = rawInterval === "year" ? "yearly" : rawInterval === "month" ? "monthly" : null
  const discountPct = Math.max(0, Math.min(100, Math.round(detail?.discount ?? 0)))
  return {
    productId: product.product_id,
    name: product.name ?? "",
    description: product.description ?? "",
    minor,
    currency,
    discountPct,
    interval,
    trialDays: detail?.trial_period_days ?? 0,
    recurring: !!product.is_recurring,
    image: product.image ?? null,
    taxCategory: product.tax_category ?? null,
    metadata: product.metadata ?? {},
  }
}

/**
 * Cancel a subscription. By default the cancellation takes effect at the end of
 * the current billing period (access continues until then). Pass `immediate` to
 * terminate right away.
 */
export async function cancelSubscription(
  subscriptionId: string,
  env: DodoEnv,
  immediate = false,
): Promise<DodoSubscription> {
  return call<DodoSubscription>(`/subscriptions/${subscriptionId}`, env, {
    method: "PATCH",
    body: JSON.stringify(
      immediate ? { status: "cancelled" } : { cancel_at_next_billing_date: true },
    ),
  })
}

/**
 * Undo a pending end-of-period cancellation: the subscription keeps renewing as
 * usual. Clears `cancel_at_next_billing_date`. The subscription must still be
 * active (not yet expired) for this to take effect.
 */
export async function resumeSubscription(subscriptionId: string, env: DodoEnv): Promise<DodoSubscription> {
  return call<DodoSubscription>(`/subscriptions/${subscriptionId}`, env, {
    method: "PATCH",
    body: JSON.stringify({ cancel_at_next_billing_date: false }),
  })
}

/**
 * Resolve the Dodo product id for a plan + billing cycle from env config.
 *
 * This is the *fallback* path: the source of truth is the plans table
 * (dodo_product_monthly / dodo_product_yearly), which admins configure. Env
 * vars are only used when a plan row has no product id set.
 */
export function productIdForPlan(planKey: string, cycle: "monthly" | "yearly"): string | null {
  const byPlan: Record<string, { monthly?: string; yearly?: string }> = {
    personal: {
      monthly: process.env.DODO_PRODUCT_PERSONAL_MONTHLY,
      yearly: process.env.DODO_PRODUCT_PERSONAL_YEARLY,
    },
    business: {
      monthly: process.env.DODO_PRODUCT_BUSINESS_MONTHLY,
      yearly: process.env.DODO_PRODUCT_BUSINESS_YEARLY,
    },
    premium: {
      monthly: process.env.DODO_PRODUCT_PREMIUM_MONTHLY,
      yearly: process.env.DODO_PRODUCT_PREMIUM_YEARLY,
    },
  }
  const entry = byPlan[planKey]
  if (!entry) return null
  // Never cross-fall-back between cycles: returning the monthly product for a
  // yearly request would charge the wrong billing frequency. Return null so the
  // caller fails loudly instead.
  return (cycle === "yearly" ? entry.yearly : entry.monthly) || null
}

/**
 * Cancel any scheduled (future) plan change on a subscription. Dodo allows only
 * one pending change at a time, so this is called before scheduling/applying a
 * new one. A 404 (no scheduled change exists) is treated as success.
 */
export async function cancelScheduledChange(subscriptionId: string, env: DodoEnv): Promise<void> {
  const res = await fetch(
    `${baseFor(env)}/subscriptions/${encodeURIComponent(subscriptionId)}/change-plan/scheduled`,
    { method: "DELETE", headers: { Authorization: authHeader(env) } },
  )
  if (res.ok || res.status === 404) return
  const text = await res.text().catch(() => "")
  throw new Error(`Dodo cancel-scheduled-change ${res.status}: ${text}`)
}

/** Map a Dodo subscription status onto our internal subscription status enum. */
export function mapDodoStatus(dodoStatus: string): "active" | "past_due" | "cancelled" | "pending" {
  switch (dodoStatus) {
    case "active":
      return "active"
    case "on_hold":
    case "failed":
      return "past_due"
    case "cancelled":
    case "expired":
      return "cancelled"
    case "pending":
    default:
      return "pending"
  }
}

/** Does `rawBody` verify against this specific webhook secret? */
function signatureMatches(
  rawBody: string,
  headers: { id: string; timestamp: string; signature: string },
  secret: string,
): boolean {
  const keyBytes = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64")
  const signedContent = `${headers.id}.${headers.timestamp}.${rawBody}`
  const expected = createHmac("sha256", keyBytes).update(signedContent).digest("base64")

  // The signature header is a space-separated list of `v1,<base64sig>` tokens.
  const passed = headers.signature.split(" ").map((part) => (part.includes(",") ? part.split(",")[1] : part))
  const expectedBuf = Buffer.from(expected)
  return passed.some((sig) => {
    const sigBuf = Buffer.from(sig)
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)
  })
}

/**
 * Verify a Dodo webhook using the Standard Webhooks spec.
 * Headers: `webhook-id`, `webhook-timestamp`, `webhook-signature`.
 * Signed content: `${id}.${timestamp}.${rawBody}`, HMAC-SHA256 (base64) keyed by
 * the base64-decoded secret (the part after the `whsec_` prefix).
 *
 * A webhook doesn't announce which Dodo environment it came from, so we try both
 * the test and live signing secrets and report which one matched. Throws only
 * when neither environment has a secret configured (a misconfiguration).
 */
export function verifyWebhookSignature(
  rawBody: string,
  headers: { id?: string; timestamp?: string; signature?: string },
): { valid: boolean; env?: DodoEnv } {
  const candidates: Array<[DodoEnv, string]> = (["test", "live"] as const)
    .map((env): [DodoEnv, string | undefined] => [env, webhookSecretFor(env)])
    .filter((pair): pair is [DodoEnv, string] => !!pair[1])
  if (candidates.length === 0) throw new Error("DODO_PAYMENTS_WEBHOOK_SECRET not configured")

  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature) return { valid: false }

  for (const [env, secret] of candidates) {
    if (signatureMatches(rawBody, { id, timestamp, signature }, secret)) return { valid: true, env }
  }
  return { valid: false }
}
