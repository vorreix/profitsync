import { readFileSync } from "node:fs"
import { sql } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"

import { appliedSql, balanceShiftSql, ledgerMovesSql } from "./tx-legs.js"

// DB-free: the SQL the shared claim-first helper emits (MC-058 / MC-059), and
// a guard that every listed writer moves balances through it — in the same
// statement as its rows, never as a second UPDATE.
const dialect = new PgDialect()
const render = (q: ReturnType<typeof sql>) => dialect.sqlToQuery(q)
const flat = (s: string) => s.replace(/\s+/g, " ")

describe("ledgerMovesSql: the wealth-ledger sign rules, in SQL", () => {
  it("create applies every row, system rows included (they ARE the balance they write)", () => {
    const { sql: text } = render(ledgerMovesSql("created", "create"))
    expect(flat(text)).toBe(`select wealth_account_id, (case when type = 'incoming' then amount::numeric else -(amount::numeric) end) as delta from "created"`)
  })

  it("restore re-applies and trash takes back, both skipping system rows (reversesOnTrash)", () => {
    const restore = flat(render(ledgerMovesSql("flipped", "restore")).sql)
    const trash = flat(render(ledgerMovesSql("flipped", "trash")).sql)
    expect(restore).toContain("as delta from \"flipped\" where not coalesce(is_system, false)")
    expect(restore).not.toContain("-(case")
    expect(trash).toContain("-(case when type = 'incoming'")
    expect(trash).toContain("where not coalesce(is_system, false)")
  })
})

describe("balanceShiftSql: one relative UPDATE per account, from the claimed rows only", () => {
  it("sums per account, skips rows without one and accounts that net to zero", () => {
    const { sql: text, params } = render(balanceShiftSql(sql`select 1`, "user-1"))
    const s = flat(text)
    expect(s).toContain("set current_balance = wa.current_balance + s.delta, updated_by = $1, updated_at = now()")
    expect(s).toContain("where wealth_account_id is not null group by wealth_account_id")
    expect(s).toContain("where wa.id = s.wealth_account_id and s.delta <> 0")
    expect(params).toEqual(["user-1"])
  })

  it("never writes an absolute balance, and leaves updated_by alone without a user", () => {
    const s = flat(render(balanceShiftSql(sql`select 1`, null)).sql)
    expect(s).not.toContain("updated_by")
    expect(s).not.toMatch(/current_balance = \$/)
  })

  it("appliedSql is balanceDelta: incoming +, outgoing −", () => {
    const { sql: text, params } = render(appliedSql("outgoing", "10.00"))
    expect(text).toBe("(case when $1 = 'incoming' then $2::numeric else -($3::numeric) end)")
    expect(params).toEqual(["outgoing", "10.00", "10.00"])
  })
})

describe("every listed writer moves balances in the statement that claims its rows", () => {
  const read = (file: string) => readFileSync(file, "utf8")
  const cases: Array<[string, string]> = [
    ["api/_routes/transactions.ts", 'balanceShiftCte(ledgerMovesSql("created", "create"), userId)'],
    ["api/_routes/transactions/[id].ts", "balanceShiftCte(moves, userId)"],
    ["api/_routes/trash/restore.ts", 'balanceShiftCte(ledgerMovesSql("restored_rows", "restore"), userId)'],
    ["api/_lib/client-trash.ts", 'balanceShiftSql(ledgerMovesSql("live", "trash"), userId)'],
    ["api/_routes/trash/purge.ts", "purgeTrashedClients(orgId, userId, id)"],
    ["api/_routes/trash/clear.ts", "purgeTrashedClients(orgId, userId)"],
    ["api/_routes/debts/[id]/payments/[paymentId].ts", "setRowsTrashed("],
    ["api/_lib/recurring-materialize.ts", 'balanceShiftCte(ledgerMovesSql("occurrence", "create"), null)'],
    ["api/_routes/wealth/accounts/[id].ts", 'balanceShiftSql(ledgerMovesSql("adjustment", "create"), userId)'],
    ["api/_routes/debts/[id].ts", 'balanceShiftSql(ledgerMovesSql("adjustment", "create"), userId)'],
  ]
  for (const [file, call] of cases) {
    it(file, () => {
      const src = read(file)
      expect(src).toContain(call)
      // the old shape: a separate balance UPDATE, computed in JS
      expect(src).not.toMatch(/currentBalance: sql`/)
      expect(src).not.toMatch(/reversalsByAccount|applicationsByAccount/)
    })
  }

  it("Adjust balance and debt reconcile measure the gap under the row lock, never write an absolute balance (MC-056)", () => {
    for (const file of ["api/_routes/wealth/accounts/[id].ts", "api/_routes/debts/[id].ts"]) {
      const src = flat(read(file))
      expect(src).toMatch(/::numeric - current_balance(, 2\))? as delta from wealth_accounts where id = \$\{id\}::uuid for update/)
      expect(src).toContain("from fresh where delta <> 0")
      expect(src).not.toContain("currentBalance: String(")
    }
  })

  it("client purge (single and Empty trash) claims the client and RETURNs its rows before reversing the live ones", () => {
    const src = flat(read("api/_lib/client-trash.ts"))
    expect(src).toContain("delete from clients where organization_id = ${orgId}::uuid and deleted_at is not null")
    expect(src).toContain("delete from transactions where client_id in (select id from gone)")
    expect(src).toContain("select * from purged where deleted_at is null")
    const clear = read("api/_routes/trash/clear.ts")
    expect(clear).not.toContain("delete(clients)")
  })

  it("client restore reads the client's deleted_at under its lock, in the statement that restores the rows", () => {
    const src = flat(read("api/_routes/trash/restore.ts"))
    expect(src).toContain("select id, deleted_at from clients where id = ${id}::uuid and organization_id = ${orgId}::uuid and deleted_at is not null for update")
    expect(src).toContain("in (select o.id, o.deleted_at from old o join restored_client r on r.id = o.id)")
    expect(src).not.toContain("eq(transactions.deletedAt, deletedAt)")
  })

  it("POST inserts the row and moves its balance in one statement, without a fake replay guard", () => {
    const src = read("api/_routes/transactions.ts")
    expect(src).not.toContain("onConflictDoNothing({ target: transactions.id })")
    expect(src).toContain('db.with(created, balanceShiftCte(ledgerMovesSql("created", "create"), userId)).select().from(created)')
  })

  it("a new account and its Opening Balance row are one batch", () => {
    const src = flat(read("api/_lib/wealth-accounts.ts"))
    expect(src).toMatch(/await dbBatch\(\[ insertAccount, db \.insert\(transactions\)/)
    expect(src).toContain('description: "Opening Balance"')
    expect(src).not.toContain("createSystemTransaction")
  })
})
