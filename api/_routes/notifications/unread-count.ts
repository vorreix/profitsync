import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, eq, isNull, or } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { notifications } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"

// Tiny, cheap endpoint the bell polls. Counts the recipient's unread rows for the
// ACTIVE org plus account-level (org-less) ones — matching the org-scoped drawer
// (see api/_routes/notifications.ts). The client refetches on org change.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const [{ value }] = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, ctx.userId),
        or(eq(notifications.organizationId, ctx.orgId), isNull(notifications.organizationId)),
        isNull(notifications.readAt),
      ),
    )

  return res.json({ count: value })
}
