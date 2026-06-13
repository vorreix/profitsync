import type { VercelRequest, VercelResponse } from "@vercel/node"
import { getResolvedAdmin } from "../../_lib/admin.js"
import { getUserId } from "../../_lib/auth.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  // Resolution understands custom roles (admin_roles) and returns the exact
  // capability set — the client gates ALL admin UI off `caps`, never the role
  // name, so custom roles work everywhere automatically.
  const admin = await getResolvedAdmin(userId)
  if (!admin) return res.status(403).json({ error: "Forbidden" })

  return res.json({ userId, isAdmin: true, role: admin.role, caps: admin.caps })
}
