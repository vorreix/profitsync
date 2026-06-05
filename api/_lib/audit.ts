import { db } from "../../src/lib/db/index.js"
import { auditLogs } from "../../src/lib/db/schema.js"

export type AuditEntity = "client" | "transaction" | "quotation" | "wealth_account"
export type AuditAction = "create" | "update" | "delete" | "close" | "reopen"
export type AuditChanges = Record<string, { from: unknown; to: unknown }>

// Append one audit entry. Auditing must never break the mutation it records, so
// failures are swallowed.
export async function logAudit(opts: {
  orgId: string
  entityType: AuditEntity
  entityId: string
  action: AuditAction
  actorId?: string | null
  changes?: AuditChanges
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      organizationId: opts.orgId,
      entityType: opts.entityType,
      entityId: opts.entityId,
      action: opts.action,
      actorUserId: opts.actorId ?? null,
      changes: opts.changes ?? {},
    })
  } catch {
    /* non-fatal */
  }
}

// Build a field → { from, to } diff for the given keys. Values are compared as
// strings so "5" === 5; only changed fields are included.
export function diffFields(
  before: Record<string, unknown> | undefined | null,
  after: Record<string, unknown> | undefined | null,
  fields: string[],
): AuditChanges {
  const changes: AuditChanges = {}
  for (const f of fields) {
    const a = before?.[f]
    const b = after?.[f]
    const an = a == null ? "" : String(a)
    const bn = b == null ? "" : String(b)
    if (an !== bn) changes[f] = { from: a ?? null, to: b ?? null }
  }
  return changes
}
