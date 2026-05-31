import type { VercelRequest, VercelResponse } from "@vercel/node"
import { requireAdmin } from "../../_lib/admin.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireAdmin(req, res)
  if (!userId) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
  return res.json({ userId, isAdmin: true })
}
