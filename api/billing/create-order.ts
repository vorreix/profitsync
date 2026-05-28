import type { VercelRequest, VercelResponse } from "@vercel/node"
import { requireAuth } from "../_lib/auth"
import { createOrder } from "../_lib/razorpay"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const { amount, currency = "INR", receipt } = req.body as {
    amount?: number
    currency?: string
    receipt?: string
  }

  if (!amount || amount < 100) return res.status(400).json({ error: "amount must be at least 100 paise" })
  if (!receipt) return res.status(400).json({ error: "receipt is required" })

  try {
    const order = await createOrder({ amount, currency, receipt })
    return res.json({ order_id: order.id, amount: order.amount, currency: order.currency })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create order" })
  }
}
