import type { VercelRequest, VercelResponse } from "@vercel/node"
import { requireAuth } from "../../_lib/auth.js"
import { searchBrands } from "../../_lib/bank-brand.js"

/**
 * Bank-name autocomplete. Proxies the Brandfetch Brand Search API server-side
 * (keeps the key off the client) and returns lightweight candidates. Always 200
 * with an array — an empty array just means "no suggestions" and the field still
 * works as free text.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const q = (req.query.q as string | undefined)?.trim() ?? ""
  if (q.length < 2) return res.json([])

  const results = await searchBrands(q)
  return res.json(results)
}
