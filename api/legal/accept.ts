import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db"
import { legalAcceptances, userProfiles } from "../../src/lib/db/schema"
import { getUserId } from "../_lib/auth"

const KNOWN_DOCS = new Set(["privacy_policy", "terms_of_service"])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const { documents, version } = req.body as { documents?: string[]; version?: string }
  if (!Array.isArray(documents) || documents.length === 0) {
    return res.status(400).json({ error: "documents must be a non-empty array" })
  }
  if (!version?.trim()) return res.status(400).json({ error: "version is required" })
  for (const d of documents) {
    if (!KNOWN_DOCS.has(d)) return res.status(400).json({ error: `Unknown document ${d}` })
  }

  const inserted = await db
    .insert(legalAcceptances)
    .values(documents.map((d) => ({ userId, document: d, version: version.trim() })))
    .returning()

  await db
    .update(userProfiles)
    .set({ termsAcceptedAt: new Date(), updatedAt: new Date() })
    .where(eq(userProfiles.id, userId))

  return res.status(201).json(inserted.map(serialize))
}
