import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, desc, eq, ilike, isNull, ne, or, sql } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { categories, clients, quotations, transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import { requireAuth } from "../_lib/auth.js"

const ENTITY_LIMIT = 6
const AUX_LIMIT = 4

// Global search: one org-scoped round trip over the five searchable tables.
// Read-only, so any role may call it; visibility rules mirror the list pages
// (soft-deleted rows and transfer legs are never surfaced).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
  const auth = await requireAuth(req, res)
  if (!auth) return
  const { orgId } = auth

  const q = String((req.query as { q?: string }).q ?? "").trim().slice(0, 120)
  if (q.length < 2) return res.status(400).json({ error: "query too short" })
  // Escape LIKE wildcards so "test_" matches the literal string, not a pattern
  // (Postgres' default ESCAPE character is backslash). The ILIKE predicates are
  // served by the pg_trgm GIN indexes (mig 0054); ranking below uses the RAW
  // query — word_similarity() wants the text, not the pattern.
  const term = `%${q.replace(/[\\%_]/g, "\\$&")}%`

  const [clientRows, txRows, quoteRows, accountRows, categoryRows] = await Promise.all([
    db
      .select({ id: clients.id, name: clients.name, company: clients.company, status: clients.status })
      .from(clients)
      .where(and(
        eq(clients.organizationId, orgId),
        isNull(clients.deletedAt),
        or(ilike(clients.name, term), ilike(clients.company, term), ilike(clients.email, term)),
      ))
      // Best trigram match first, name as the tiebreaker.
      .orderBy(
        sql`greatest(word_similarity(${q}, ${clients.name}), word_similarity(${q}, ${clients.company})) desc`,
        asc(clients.name),
      )
      .limit(ENTITY_LIMIT),
    db
      .select({
        id: transactions.id,
        description: transactions.description,
        amount: transactions.amount,
        type: transactions.type,
        date: transactions.date,
        category: transactions.category,
        clientId: transactions.clientId,
        clientName: clients.name,
      })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(and(
        eq(clients.organizationId, orgId),
        isNull(transactions.deletedAt),
        isNull(clients.deletedAt),
        ne(transactions.kind, "transfer"),
        or(
          ilike(transactions.description, term),
          ilike(transactions.category, term),
          sql`${transactions.tags}::text ilike ${term}`,
          ilike(clients.name, term),
        ),
      ))
      .orderBy(desc(transactions.date))
      .limit(ENTITY_LIMIT),
    db
      .select({
        id: quotations.id,
        title: quotations.title,
        prospectName: quotations.prospectName,
        status: quotations.status,
        amount: quotations.amount,
      })
      .from(quotations)
      .where(and(
        eq(quotations.organizationId, orgId),
        isNull(quotations.deletedAt),
        or(
          ilike(quotations.title, term),
          ilike(quotations.prospectName, term),
          ilike(quotations.company, term),
          ilike(quotations.email, term),
        ),
      ))
      .orderBy(
        sql`greatest(word_similarity(${q}, ${quotations.title}), word_similarity(${q}, ${quotations.prospectName})) desc`,
        desc(quotations.date),
      )
      .limit(ENTITY_LIMIT),
    db
      .select({
        id: wealthAccounts.id,
        bankName: wealthAccounts.bankName,
        nickname: wealthAccounts.nickname,
        type: wealthAccounts.type,
        icon: wealthAccounts.icon,
      })
      .from(wealthAccounts)
      .where(and(
        eq(wealthAccounts.organizationId, orgId),
        isNull(wealthAccounts.archivedAt),
        or(ilike(wealthAccounts.bankName, term), ilike(wealthAccounts.nickname, term)),
      ))
      .orderBy(
        sql`greatest(word_similarity(${q}, ${wealthAccounts.bankName}), word_similarity(${q}, ${wealthAccounts.nickname})) desc`,
        asc(wealthAccounts.bankName),
      )
      .limit(AUX_LIMIT),
    db
      .select({ id: categories.id, name: categories.name, type: categories.type, color: categories.color })
      .from(categories)
      .where(and(eq(categories.organizationId, orgId), ilike(categories.name, term)))
      .orderBy(sql`word_similarity(${q}, ${categories.name}) desc`, asc(categories.name))
      .limit(AUX_LIMIT),
  ])

  return res.json({
    clients: clientRows.map(serialize),
    transactions: txRows.map(serialize),
    quotations: quoteRows.map(serialize),
    accounts: accountRows.map(serialize),
    categories: categoryRows.map(serialize),
  })
}
