import type { VercelRequest, VercelResponse } from "@vercel/node"
import { requireAuth } from "../_lib/auth"
import { verifyPaymentSignature } from "../_lib/razorpay"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body as {
    razorpay_order_id?: string
    razorpay_payment_id?: string
    razorpay_signature?: string
  }

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: "razorpay_order_id, razorpay_payment_id, and razorpay_signature are required" })
  }

  const valid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)
  if (!valid) return res.status(400).json({ error: "Invalid payment signature" })

  return res.json({ success: true, payment_id: razorpay_payment_id, order_id: razorpay_order_id })
}
