import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { claimReplacedLegsSql, groupWriteWentStale, legShifts, lockReplacingSql, postGroupStatements, type PreparedGroup } from "./tx-group-write.js"

// DB-FREE guards for the split write path (MC-046): an edit replaces the legs
// in ONE batch, the old legs' balance comes back out exactly once, and a
// replayed or raced save rolls back instead of posting the new legs twice.

const read = (file: string) => readFileSync(file, "utf8")
const group = (legs: { accountId: string; amount: number }[], type = "outgoing"): PreparedGroup => ({
  clientId: "c", type, kind: "standard", description: "", category: "", tags: [], date: "2026-09-01",
  legs: legs.map((leg, i) => ({ id: `id-${i}`, cardId: null, currencyCode: "EUR", ...leg })),
})

describe("legShifts", () => {
  it("collapses legs on one account, outgoing negative, in exact decimals", () => {
    const shifts = legShifts("outgoing", [{ accountId: "a", amount: 0.1 }, { accountId: "a", amount: 0.2 }, { accountId: "b", amount: 20 }])
    expect(shifts.get("a")!.toFixed()).toBe("-0.3")
    expect(shifts.get("b")!.toFixed()).toBe("-20")
    expect(legShifts("incoming", [{ accountId: "a", amount: "12.5" }]).get("a")!.toFixed()).toBe("12.5")
  })
})

describe("postGroupStatements", () => {
  it("gives a real split one group id, a single leg none, and one balance UPDATE per account", () => {
    expect(postGroupStatements(group([{ accountId: "a", amount: 5 }]), "u").groupId).toBeNull()
    const split = postGroupStatements(group([{ accountId: "a", amount: 5 }, { accountId: "a", amount: 6 }, { accountId: "b", amount: 7 }]), "u")
    expect(split.groupId).toMatch(/^[0-9a-f-]{36}$/)
    expect(split.shifts).toHaveLength(2)
  })

  it("stamps the legs a millisecond apart, lead leg first (the list opens a split by its earliest leg)", () => {
    const { insert } = postGroupStatements(group([{ accountId: "a", amount: 5 }, { accountId: "b", amount: 6 }]), "u")
    const { sql, params } = insert.toSQL()
    expect(sql).toContain('"created_at"')
    const stamps = params.filter((p): p is string => typeof p === "string" && /^\d{4}-\d{2}-\d{2}T/.test(p))
    expect(stamps.length).toBeGreaterThanOrEqual(2)
    expect(new Date(stamps[0]) < new Date(stamps[stamps.length - 1])).toBe(true)
  })

  it("updates the accounts in id order whatever order the legs came in (no lock-order deadlock)", () => {
    const { shifts } = postGroupStatements(group([{ accountId: "c", amount: 1 }, { accountId: "a", amount: 2 }, { accountId: "b", amount: 3 }]), "u")
    expect(shifts.map((s) => s.toSQL().params.at(-1))).toEqual(["a", "b", "c"])
  })
})

describe("lockReplacingSql", () => {
  const [legs, accounts] = lockReplacingSql(["11111111-1111-1111-1111-111111111111"], ["33333333-3333-3333-3333-333333333333"]).map((q) => new PgDialect().sqlToQuery(q).sql)

  it("locks the replaced legs first, FOR UPDATE (an in-flight attachment upload commits first and is moved)", () => {
    expect(legs).toMatch(/^select id from transactions where id in \(.+\) order by id for update$/)
  })

  it("then every old and new account, in id order, without blocking a plain insert's FK check", () => {
    expect(accounts).toContain("select wealth_account_id from transactions where id in")
    expect(accounts).toMatch(/order by id for no key update of wealth_accounts$/)
  })
})

describe("claimReplacedLegsSql", () => {
  const { sql, params } = new PgDialect().sqlToQuery(claimReplacedLegsSql(["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"], "u"))

  it("deletes only live plain legs — never a transfer-owned or system row", () => {
    expect(sql).toContain("delete from transactions")
    expect(sql).toContain("deleted_at is null and transfer_id is null and not is_system and kind <> 'transfer'")
  })

  it("reverses the balance from the rows the DELETE removed, not from an earlier read", () => {
    expect(sql).toContain("from gone")
    expect(sql).toContain("case when type = 'incoming' then amount else -amount end")
    expect(sql).toContain("current_balance = wa.current_balance - shifts.applied")
  })

  it("fails the whole batch unless it removed every leg (a replay or race rolls back)", () => {
    expect(sql).toMatch(/select 1 \/ \(\(select count\(\*\) from gone\) = \$\d+::int\)::int/)
    expect(params).toContain(2)
  })

  it("its failure — or an account's currency changing before COMMIT — is recognised however the driver wraps it", () => {
    expect(groupWriteWentStale({ code: "22012" })).toBe(true)
    expect(groupWriteWentStale(new Error("x", { cause: { code: "22012" } }))).toBe(true)
    expect(groupWriteWentStale(new Error("x", { cause: { code: "23503", constraint: "transactions_account_currency_fk" } }))).toBe(true)
    expect(groupWriteWentStale({ code: "23503", message: 'violates foreign key constraint "transactions_account_currency_fk"' })).toBe(true)
    expect(groupWriteWentStale({ code: "23503", constraint: "transactions_client_id_clients_id_fk" })).toBe(false)
    expect(groupWriteWentStale({ code: "23505" })).toBe(false)
  })
})

describe("PUT /api/transactions/group/:groupId", () => {
  const src = read("api/_routes/transactions/group/[groupId].ts")

  it("runs in one dbBatch: locks, legs, attachments, claim, recurring key, shifts — in that order", () => {
    expect(src).toContain("dbBatch(")
    const order = ["...lockReplacingSql(", "    insert,", "db.update(transactionAttachments)", "db.execute(claimReplacedLegsSql(", "recurringDueDate: recurring.recurringDueDate", "...shifts,"]
    const at = order.map((needle) => src.indexOf(needle))
    expect(at.every((i) => i > 0)).toBe(true)
    expect([...at].sort((x, y) => x - y)).toEqual(at)
  })

  it("refuses debt, system and transfer groups with the PATCH codes, in PATCH's order", () => {
    const at = ["debt_group", "system_row", "transfer_mutation_requires_transfer_service"].map((code) => src.indexOf(`code: "${code}"`))
    expect(at.every((i) => i > 0)).toBe(true)
    // A repayment's principal legs are transfers in the same group: debt first.
    expect([...at].sort((x, y) => x - y)).toEqual(at)
    expect(src).toContain('code: "transaction_changed"')
  })

  it("both split writers answer a lost race as the stale refusal, not a 500", () => {
    for (const file of ["api/_routes/transactions/group/[groupId].ts", "api/_routes/transactions/group.ts"]) {
      expect(read(file)).toMatch(/if \(groupWriteWentStale\(err\)\) \{\s*return res\.status\(409\)\.json\(\{[^}]*code: "transaction_changed"/)
    }
  })

  it("the edit dialogs replace a split with PUT, never DELETE + POST (no Trash copy, no half-done save)", () => {
    for (const file of ["src/pages/TransactionsPage.tsx", "src/pages/ClientDetailPage.tsx"]) {
      const page = read(file)
      expect(page).toContain("apiPut(`/api/transactions/group/${")
      expect(page).not.toMatch(/apiDelete\(`\/api\/transactions\/\$\{edit\w*Form\.id\}`/)
    }
  })
})
