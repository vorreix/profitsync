import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clients, notificationPreferences } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"
import { sanitizePreferences, type PreferenceScope } from "../../../src/lib/notifications.js"

// Notification preferences at three scopes:
//   ?scope=user           → the calling user's own prefs (the base of the cascade)
//   ?scope=organization   → org-wide policy for the active org (read: any member;
//                           write: owner/admin)
//   ?scope=client&clientId=… → per-client policy (read: any member; write: canWrite)
//
// Stored as a full sanitized preference grid per existing row; resolution
// (delivery) cascades client → org → user → system defaults — a row that does
// not exist is simply skipped in the cascade (see src/lib/notifications.ts).

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

function parseScope(v: string | undefined): PreferenceScope | null {
  return v === "user" || v === "organization" || v === "client" ? v : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return

  const scope = parseScope(single(req.query.scope)) ?? "user"
  const canManageOrg = ctx.role === "owner" || ctx.role === "admin"
  const canManageClient = ctx.role === "owner" || ctx.role === "admin" || ctx.role === "editor"

  // Resolve the target columns for the chosen scope, validating ownership.
  let lookup
  let writeAllowed = true
  if (scope === "user") {
    lookup = and(eq(notificationPreferences.scope, "user"), eq(notificationPreferences.userId, ctx.userId))
  } else if (scope === "organization") {
    lookup = and(
      eq(notificationPreferences.scope, "organization"),
      eq(notificationPreferences.organizationId, ctx.orgId),
    )
    writeAllowed = canManageOrg
  } else {
    const clientId = single(req.query.clientId) ?? single((req.body as { client_id?: string })?.client_id)
    if (!clientId) return res.status(400).json({ error: "Missing clientId for client scope" })
    // The client must belong to the active org (and not be trashed).
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.organizationId, ctx.orgId), isNull(clients.deletedAt)))
      .limit(1)
    if (!client) return res.status(404).json({ error: "Client not found" })
    lookup = and(
      eq(notificationPreferences.scope, "client"),
      eq(notificationPreferences.organizationId, ctx.orgId),
      eq(notificationPreferences.clientId, clientId),
    )
    writeAllowed = canManageClient
  }

  if (req.method === "GET") {
    const [row] = await db.select().from(notificationPreferences).where(lookup).limit(1)
    return res.json({ scope, preferences: row ? sanitizePreferences(row.preferences) : {} })
  }

  if (req.method === "PUT") {
    if (!writeAllowed) return res.status(403).json({ error: "Insufficient permissions" })
    const clean = sanitizePreferences((req.body as { preferences?: unknown })?.preferences)

    const [existing] = await db.select({ id: notificationPreferences.id }).from(notificationPreferences).where(lookup).limit(1)
    if (existing) {
      const [updated] = await db
        .update(notificationPreferences)
        .set({ preferences: clean, updatedBy: ctx.userId, updatedAt: new Date() })
        .where(eq(notificationPreferences.id, existing.id))
        .returning()
      return res.json(serialize(updated))
    }

    const clientId = single(req.query.clientId) ?? single((req.body as { client_id?: string })?.client_id)
    const [created] = await db
      .insert(notificationPreferences)
      .values({
        scope,
        userId: scope === "user" ? ctx.userId : null,
        organizationId: scope === "user" ? null : ctx.orgId,
        clientId: scope === "client" ? clientId : null,
        preferences: clean,
        updatedBy: ctx.userId,
      })
      .returning()
    return res.json(serialize(created))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
