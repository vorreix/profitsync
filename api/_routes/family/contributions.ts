import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clients, transactions, userProfiles } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"
import { imageSrc } from "../../_lib/image-upload.js"
import { sumContributionsByMember } from "../../../src/lib/family.js"

// GET /api/family/contributions — who funded the household (and who drew from it).
// Reads cross-org family-transfer legs recorded in the ACTIVE family org and
// aggregates them per member. Privacy-safe: only Clerk user ids (rendered as
// already-known member names) are exposed — never a personal account.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
  if (ctx.accountType !== "family") {
    return res.status(403).json({ error: "Not a family workspace", code: "not_a_family" })
  }
  const familyOrgId = ctx.orgId

  const legs = await db
    .select({
      familyPartyUserId: transactions.familyPartyUserId,
      type: transactions.type,
      amount: transactions.amount,
    })
    .from(transactions)
    .innerJoin(clients, eq(clients.id, transactions.clientId))
    .where(
      and(
        eq(clients.organizationId, familyOrgId),
        eq(transactions.familyTransfer, true),
        isNull(transactions.deletedAt),
      ),
    )

  const byMember = sumContributionsByMember(legs)

  const ids = byMember.map((m) => m.userId)
  const profs = ids.length
    ? await db
        .select({
          id: userProfiles.id,
          fullName: userProfiles.fullName,
          email: userProfiles.email,
          avatarData: userProfiles.avatarData,
          avatarMime: userProfiles.avatarMime,
        })
        .from(userProfiles)
        .where(inArray(userProfiles.id, ids))
    : []
  const profMap = new Map(profs.map((p) => [p.id, p]))

  const members = byMember.map((m) => {
    const p = profMap.get(m.userId)
    return serialize({
      userId: m.userId,
      fullName: p?.fullName ?? null,
      email: p?.email ?? null,
      avatarSrc: imageSrc(p?.avatarData ?? "", p?.avatarMime ?? ""),
      contributed: m.contributed,
      received: m.received,
      net: m.net,
    })
  })

  const totalContributed = byMember.reduce((s, m) => s + m.contributed, 0)
  const totalDisbursed = byMember.reduce((s, m) => s + m.received, 0)

  return res.json({
    members,
    total_contributed: totalContributed,
    total_disbursed: totalDisbursed,
  })
}
