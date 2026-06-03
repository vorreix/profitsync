import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "../../../../src/lib/db/index.js"
import {
  clientAttachments,
  clients,
  quotationAttachments,
  quotations,
  transactionAttachments,
  transactions,
} from "../../../../src/lib/db/schema.js"
import { requireAuth, requireBusinessFeature } from "../../../_lib/auth.js"

async function verifyClientOrg(clientId: string, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.organizationId, orgId)))
  return !!row
}

// Aggregated view of every attachment related to a client: the client's own
// documents, attachments on its (non-deleted) transactions, and attachments on
// quotations that were converted into this client (linked_client_id). Each row
// carries its source so the UI can label it, link to the originating entity, and
// hit the right download/delete endpoint.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (!requireBusinessFeature(res, ctx, "clients")) return
  const { orgId } = ctx
  const { id } = req.query as { id: string }

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const owned = await verifyClientOrg(id, orgId)
  if (!owned) return res.status(404).json({ error: "Not found" })

  const [docRows, txRows, qRows] = await Promise.all([
    db
      .select({
        id: clientAttachments.id,
        fileName: clientAttachments.fileName,
        fileType: clientAttachments.fileType,
        fileSize: clientAttachments.fileSize,
        displayName: clientAttachments.displayName,
        tags: clientAttachments.tags,
        category: clientAttachments.category,
        createdAt: clientAttachments.createdAt,
      })
      .from(clientAttachments)
      .where(eq(clientAttachments.clientId, id)),
    db
      .select({
        id: transactionAttachments.id,
        fileName: transactionAttachments.fileName,
        fileType: transactionAttachments.fileType,
        fileSize: transactionAttachments.fileSize,
        displayName: transactionAttachments.displayName,
        tags: transactionAttachments.tags,
        category: transactionAttachments.category,
        createdAt: transactionAttachments.createdAt,
        txId: transactions.id,
        txDesc: transactions.description,
        txType: transactions.type,
      })
      .from(transactionAttachments)
      .innerJoin(transactions, eq(transactions.id, transactionAttachments.transactionId))
      .where(and(eq(transactions.clientId, id), isNull(transactions.deletedAt))),
    db
      .select({
        id: quotationAttachments.id,
        fileName: quotationAttachments.fileName,
        fileType: quotationAttachments.fileType,
        fileSize: quotationAttachments.fileSize,
        displayName: quotationAttachments.displayName,
        tags: quotationAttachments.tags,
        category: quotationAttachments.category,
        createdAt: quotationAttachments.createdAt,
        qId: quotations.id,
        qTitle: quotations.title,
      })
      .from(quotationAttachments)
      .innerJoin(quotations, eq(quotations.id, quotationAttachments.quotationId))
      .where(and(eq(quotations.linkedClientId, id), eq(quotations.organizationId, orgId), isNull(quotations.deletedAt))),
  ])

  const media = [
    ...docRows.map((r) => ({
      id: r.id,
      source: "client" as const,
      source_id: id,
      source_label: "Client document",
      file_name: r.fileName,
      file_type: r.fileType,
      file_size: r.fileSize,
      display_name: r.displayName,
      tags: r.tags,
      category: r.category,
      created_at: r.createdAt,
    })),
    ...txRows.map((r) => ({
      id: r.id,
      source: "transaction" as const,
      source_id: r.txId,
      source_label: r.txDesc?.trim() || (r.txType === "incoming" ? "Income" : "Expense"),
      file_name: r.fileName,
      file_type: r.fileType,
      file_size: r.fileSize,
      display_name: r.displayName,
      tags: r.tags,
      category: r.category,
      created_at: r.createdAt,
    })),
    ...qRows.map((r) => ({
      id: r.id,
      source: "quotation" as const,
      source_id: r.qId,
      source_label: r.qTitle?.trim() || "Quotation",
      file_name: r.fileName,
      file_type: r.fileType,
      file_size: r.fileSize,
      display_name: r.displayName,
      tags: r.tags,
      category: r.category,
      created_at: r.createdAt,
    })),
  ]

  media.sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0
    return tb - ta
  })

  // Server-side pagination over the merged, metadata-only list. Without
  // limit/offset the full list is returned (back-compat).
  const limitRaw = parseInt((req.query.limit as string) ?? "", 10)
  const offsetRaw = parseInt((req.query.offset as string) ?? "", 10)
  if (Number.isFinite(limitRaw)) {
    const limit = Math.min(Math.max(1, limitRaw), 100)
    const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0)
    const items = media.slice(offset, offset + limit)
    return res.json({
      items,
      total: media.length,
      limit,
      offset,
      has_next: offset + limit < media.length,
      has_prev: offset > 0,
    })
  }

  return res.json(media)
}
