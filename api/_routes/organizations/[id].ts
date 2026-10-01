import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { organizations, organizationMembers, userProfiles } from "../../../src/lib/db/schema.js"
import { getUserId } from "../../_lib/auth.js"
import { imageSrc, validateImageUpload } from "../../_lib/image-upload.js"
import { setOrgCurrency } from "../../_lib/org-currency.js"
import { selectableCurrencyCode } from "../../../src/lib/money.js"

// Replace the raw logo columns with the `logo_src` data URL the UI renders.
function withLogoSrc<T extends { logoData?: unknown; logoMime?: unknown }>(row: T) {
  const { logoData, logoMime, ...rest } = row
  return {
    ...rest,
    logoSrc: imageSrc(
      typeof logoData === "string" ? logoData : null,
      typeof logoMime === "string" ? logoMime : null,
    ),
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  const { id } = req.query as { id: string }

  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, id), eq(organizationMembers.userId, userId)))
  if (!member) return res.status(404).json({ error: "Not found" })

  const [org] = await db.select().from(organizations).where(eq(organizations.id, id))
  if (!org) return res.status(404).json({ error: "Not found" })

  if (req.method === "GET") {
    return res.json(serialize(withLogoSrc({ ...org, role: member.role })))
  }

  if (req.method === "PATCH") {
    if (member.role !== "owner" && member.role !== "admin") {
      return res.status(403).json({ error: "Only owners and admins can edit organization settings" })
    }
    const { name, currency, logo_data } = req.body as { name?: string; currency?: string; logo_data?: string | null }

    const updates: Partial<typeof organizations.$inferInsert> = { updatedAt: new Date() }

    // Logo: a base64/data-URL string sets it (validated + mime sniffed
    // server-side); null or "" clears it.
    if (logo_data !== undefined) {
      if (logo_data === null || logo_data === "") {
        updates.logoData = ""
        updates.logoMime = ""
      } else {
        const img = validateImageUpload(logo_data)
        if (!img.ok) return res.status(400).json({ error: img.error })
        updates.logoData = img.data
        updates.logoMime = img.mime
      }
    }

    if (name !== undefined) {
      if (org.isPersonal) {
        return res.status(400).json({ error: "Personal organization cannot be renamed" })
      }
      if (!name.trim()) return res.status(400).json({ error: "name cannot be empty" })
      updates.name = name.trim()
    }

    // The reporting currency (and its legacy twin) only through setOrgCurrency:
    // both columns together, audited. No account, row or budget is relabelled.
    // Moving TO a currency is choosing it anew (not KWD, BHD, … — MC-031); the
    // one it already reports in passes, so re-saving the settings still works.
    const nextCurrency = currency === undefined ? undefined : selectableCurrencyCode(currency, org.reportingCurrency ?? org.currency)
    if (nextCurrency === null) return res.status(400).json({ error: "Invalid currency code", code: "invalid_currency" })

    if (Object.keys(updates).length === 1 && !nextCurrency) {
      return res.status(400).json({ error: "Nothing to update" })
    }

    const updated = nextCurrency
      ? await setOrgCurrency(id, nextCurrency, { actorId: userId, also: updates })
      : (await db.update(organizations).set(updates).where(eq(organizations.id, id)).returning())[0]
    return res.json(serialize(withLogoSrc({ ...updated, role: member.role })))
  }

  if (req.method === "DELETE") {
    if (org.isPersonal) {
      return res.status(400).json({ error: "Personal organization cannot be deleted" })
    }
    if (member.role !== "owner") {
      return res.status(403).json({ error: "Forbidden" })
    }

    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, userId))
    if (profile?.currentOrganizationId === id) {
      const [personal] = await db
        .select()
        .from(organizations)
        .where(and(eq(organizations.ownerUserId, userId), eq(organizations.isPersonal, true)))
      await db
        .update(userProfiles)
        .set({ currentOrganizationId: personal?.id ?? null, updatedAt: new Date() })
        .where(eq(userProfiles.id, userId))
    }

    await db.delete(organizations).where(eq(organizations.id, id))
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
