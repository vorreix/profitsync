import { describe, expect, it } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { PAID_LEG_SQL } from "./credit-card.js"

// DB-FREE: the expression is rendered, never run. It is the one definition of
// "paid since the close" behind the card screen, autopay and the alerts rail,
// so its reversal rule is pinned here (MC-027).
const rendered = new PgDialect().sqlToQuery(PAID_LEG_SQL).sql.replace(/\s+/g, " ")

describe("PAID_LEG_SQL — card payments net of reversals", () => {
  it("counts an incoming transfer leg only when its transfer is not a reversal and has no live reversal", () => {
    expect(rendered).toContain(
      "when t.type = 'incoming' and not exists (select 1 from transfers x where x.id = t.transfer_id and (x.reverses_transfer_id is not null or exists (select 1 from transfers r where r.reverses_transfer_id = x.id and r.deleted_at is null))) then t.amount::numeric",
    )
  })

  it("never subtracts a reversal leg: a payment made BEFORE the close and reversed after it leaves this window's paid figure alone", () => {
    // Netting on the reversal leg took the reversal off whichever window it was
    // dated in, cancelling a real post-close payment (and letting autopay pay
    // the statement twice). The only branch that adds is the incoming one.
    expect(rendered).not.toContain("-t.amount")
    expect(rendered).not.toContain("t.type = 'outgoing'")
    expect(rendered).toMatch(/else 0 end$/)
  })
})
