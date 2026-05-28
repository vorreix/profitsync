import { createHmac, timingSafeEqual } from "crypto"

const BASE = "https://api.razorpay.com/v1"

function authHeader(): string {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) {
    throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured")
  }
  return "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64")
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Razorpay ${res.status}: ${text}`)
  }
  return JSON.parse(text) as T
}

export type RazorpayPlan = {
  id: string
  entity: "plan"
  interval: number
  period: "monthly" | "yearly"
  item: { id: string; name: string; amount: number; currency: string }
}

export type RazorpaySubscription = {
  id: string
  entity: "subscription"
  plan_id: string
  status: string
  current_start: number | null
  current_end: number | null
  ended_at: number | null
  short_url: string
  notes?: Record<string, string>
}

export async function getOrCreatePlan(input: {
  name: string
  amount: number
  currency: string
  interval: "monthly" | "yearly"
}): Promise<RazorpayPlan> {
  return call<RazorpayPlan>("/plans", {
    method: "POST",
    body: JSON.stringify({
      period: input.interval,
      interval: 1,
      item: { name: input.name, amount: input.amount, currency: input.currency },
    }),
  })
}

export async function createSubscription(input: {
  planId: string
  totalCount: number
  notes?: Record<string, string>
}): Promise<RazorpaySubscription> {
  return call<RazorpaySubscription>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      plan_id: input.planId,
      total_count: input.totalCount,
      notes: input.notes ?? {},
      customer_notify: 1,
    }),
  })
}

export type RazorpayOrder = {
  id: string
  entity: "order"
  amount: number
  currency: string
  receipt: string
  status: string
}

export async function createOrder(input: {
  amount: number
  currency: string
  receipt: string
}): Promise<RazorpayOrder> {
  if (input.amount < 100) throw new Error("amount must be at least 100 paise")
  return call<RazorpayOrder>("/orders", {
    method: "POST",
    body: JSON.stringify({ amount: input.amount, currency: input.currency, receipt: input.receipt }),
  })
}

export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET
  if (!secret) throw new Error("RAZORPAY_KEY_SECRET not configured")
  const generated = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex")
  const a = Buffer.from(generated)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function cancelSubscription(subscriptionId: string, cancelAtCycleEnd = true) {
  return call<RazorpaySubscription>(`/subscriptions/${subscriptionId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0 }),
  })
}

export function verifyWebhookSignature(rawBody: string, signature: string | string[] | undefined): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) throw new Error("RAZORPAY_WEBHOOK_SECRET not configured")
  const sig = Array.isArray(signature) ? signature[0] : signature
  if (!sig) return false
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex")
  const a = Buffer.from(expected)
  const b = Buffer.from(sig)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
