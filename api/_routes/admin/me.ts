import type { VercelRequest, VercelResponse } from "@vercel/node"
import { getAdminRole } from "../../_lib/admin.js"
import { adminCaps } from "../../../src/lib/admin-roles.js"
import { getUserId } from "../../_lib/auth.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  const role = await getAdminRole(userId)
  if (!role) return res.status(403).json({ error: "Forbidden" })

  return res.json({ userId, isAdmin: true, role, caps: adminCaps(role) })
}
