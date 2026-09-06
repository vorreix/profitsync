# ProfitSync — Budgets, explained

A plain-English guide to budgeting: what the numbers mean, how spend is measured, what is
held back and why, and how personal and business workspaces differ.

> **TL;DR**
> - A **personal** workspace gets a **plan**: recurring **periods**, **budgets** (optionally
>   inside **groups** such as *Household* that add them up), and four headline numbers — the
>   most important being **Safe to spend**. The page is the hero plus ONE list, read through a
>   **week / month / year** toggle; a budget can be **hidden** (still counts) or **inactive**
>   (counts nowhere). Details: [`docs/budget-v2/SIMPLE.md`](../budget-v2/SIMPLE.md).
> - Bills, savings funds and debt payments (sections 4–5 below) are still tracked and reserved
>   by the engine, but are **no longer laid out on the budgets page**.
> - A **business** workspace keeps **per-client spend caps**, unchanged. It has no plan,
>   no envelopes and no Safe-to-spend, because business revenue is per-client and those
>   concepts have no natural meaning there.
> - Spend is **never stored** — it is summed live from transactions for the open period.
>   A **closed** period, by contrast, is frozen in a **snapshot** so history is
>   reproducible.
> - `GET /api/budgets` keeps its **v1 response shape indefinitely**, so app versions
>   pinned in the app stores keep working without an update.

The design document behind all of this is
[`docs/budget-v2/SMART_HYBRID_BUDGET_SPEC.md`](../budget-v2/SMART_HYBRID_BUDGET_SPEC.md);
delivery notes are in [`docs/budget-v2/PHASE2.md`](../budget-v2/PHASE2.md). For working on
the code, use the **`budget-v2` skill** — it carries the invariants and the verification
recipes.

---

## 1. The four numbers

The whole feature exists to answer one question honestly: **can I spend this?** Four
figures answer it, and they are deliberately different things.

| Number | What it is | What it is NOT |
|---|---|---|
| **Available now** | Liquid cash: bank + cash accounts, non-archived. Savings *Spaces* are excluded — that exclusion is what makes them savings. | Not what you can spend. |
| **Reserved** | Money still in the account but **held back** — for bills, debt payments and savings. | **Not spent.** It has not left the account. |
| **Safe to spend** | `min(available − reserved, what your plan still allows)`. The one figure that answers the question. | Not your balance, and not "remaining budget". |
| **Forecast balance** | A projection to the end of the period. | Not a current figure. |

**Safe to spend has two limits, and the screen says which one applied.** Sometimes cash is
the tighter constraint; sometimes your plan is. Showing only the number, without which
limit produced it, is what makes people distrust a budget the first time it disagrees with
their bank balance.

### Why netting matters

Plan-wide room is netted **and then floored once**:

```
headroom = max(0, Σ planned − Σ spent − Σ pending)
```

If Groceries has a 300 target with 400 spent, and Dining has a 200 target untouched, the
plan has **100** of room — not 200. Flooring each envelope first
(`max(0,−100) + max(0,200)`) would invite you to spend money the plan does not have. The
per-envelope cards still show their **own** signed figure, so an overspent category looks
overspent; only the plan-wide total is netted.

---

## 2. Periods

A plan runs in **periods**: monthly, weekly, or anchored to a payday. Exactly one period is
**open** at a time.

- The **open** period is computed live from your transactions, so it is always current.
- When a period ends it is **closed** and its figures are written to a **snapshot**. A
  closed period is never recomputed on the fly, which is what makes last month's numbers
  the same numbers next year.
- Every period records a **funding base** — what it had to work with. Spending never
  reduces it; that is what separates "capacity" from "income".
- A period created mid-month is flagged **partial**, with copy explaining the short
  window, rather than pro-rating your targets behind your back.

### When history changes anyway

If you edit, delete or restore a transaction that falls inside a **closed** period, that
period's figures are genuinely wrong. So it is **restated**: recomputed from the ledger,
written as a **new snapshot version**, and clearly labelled. The original version is kept.

The one thing a restatement does **not** recompute is cash. `Available now` was a reading
of your balances at the time and cannot be reconstructed for a past instant, so the
original figures are carried forward and marked *as at close*.

---

## 3. Envelopes and the five sections

An **envelope** is one line of the plan. Each belongs to a section, and **the sections use
different vocabulary on purpose** — conflating them is the confusion this design removes.

| Section | What it holds | Its language |
|---|---|---|
| **Income** | Expected vs received | expected · received · still to come |
| **Commitment** | Bills with due dates | paid · unpaid · overdue |
| **Flexible** | Spending categories | planned · spent · pending · remaining |
| **Savings** | Sinking funds | set aside · reserved not yet confirmed |
| **Debt** | Repayments | paid · outstanding |

Only a **flexible** envelope can be *over*: it has a target that caps spending. A bills
envelope has no target — its money is defined by the bills inside it — so a pending bill
reads **"unpaid"**, never "over". An unpaid bill is *reserved*, not overspent.

### Categories

A flexible envelope claims one or more transaction **categories**. Matching is
case-insensitive and ignores surrounding spaces, so `Groceries`, `groceries` and
`  Groceries ` are one category.

**One category belongs to exactly one envelope.** Attempting to claim a category another
envelope already has is refused, and the message names the envelope that owns it.

Whatever matches no named category lands in the **leftover** envelope — every plan has
one, and it cannot be removed, because without it the plan has no ceiling and Safe to spend
quietly degrades to "your cash balance".

---

## 4. Bills, and what "paid" means

A **commitment** is an expectation with a due date. Two kinds:

- **One-off** — a single due date, tracked only by the budget. It **never ages out**: a
  bill you forgot about is exactly the one you most need shown, so a three-year-old unpaid
  invoice still appears.
- **Recurring** — a **link** to one of your existing recurring expenses. The recurring
  expense keeps control of the amount and the schedule, and the bill is marked paid
  automatically when it posts.

An occurrence can be **settled, rescheduled, skipped or cancelled**. Critically:

> **Marking a bill paid records that money moved. It does not move any money.**

No balance changes, no transaction is created. The budget tracks expectations; your
transactions and accounts remain the record of actual money.

An overdue bill stays **reserved** until you resolve it — it is still owed.

---

## 5. Savings funds

A fund holds money back for something specific. Two modes:

|  | **Held back** (default) | **In a Space** |
|---|---|---|
| Where the money sits | In your account, reserved | Physically moved into a Space |
| Contribution | A ledger entry. No transfer, no balance change | A real transfer |
| Counts in Available now | **Yes** — the cash is still there | **No** — Spaces are excluded |
| How many you can have | **Unlimited, on every plan** | Uses your Spaces quota |

### Confirmed vs merely planned

Each period, a fund's contribution is `planned`, `confirmed`, `missed` or `skipped`.

**Only a confirmed contribution may be called "set aside".** Automatically *reserving* a
planned contribution is fair — that is what the plan says, and it only makes Safe to spend
more conservative. Automatically asserting the money **was set aside** is not: nobody did
anything, and a fund balance is a figure you will trust.

Confirming is deliberately **neutral for Safe to spend**: the amount moves from "reserved,
not yet confirmed" into the fund balance, and the headline number does not jump. That is
what makes it safe to leave a contribution unconfirmed for days.

A missed contribution is not silently forgiven — the fund's suggested monthly pace rises
and says so.

---

## 6. Refunds

An inflow that shares a category with one of your envelopes is treated as a **refund** and
netted off that category's spend. That is usually right, and ignoring it would overstate
your spending — but it is a **guess**, so the app says so and offers **"not a refund"**,
which records an audited exclusion and touches nothing about the transaction itself.

Income in a category no envelope claims is **never** netted. Salary can never cancel out
grocery spending.

For a refund that arrives in a later period, or covers only part of an expense, an explicit
**settlement link** records it — many links per expense, so "€400 reimbursed €250 in May
and €150 in June" is expressible. Two views come out of that:

- **Cash view** (authoritative): a refund counts in the period its money actually moved.
- **Attributed view** (a labelled report): the refund counts against the period the
  original expense was in, giving that expense's true cost.

Both are shown, and the report is labelled as one.

---

## 7. Overspending

An overspend is a **fact, not a failure**, and the app states it and offers options, in
order of cost to your plan:

1. Move money from an envelope that has room — total planned stays the same
2. Use unallocated money — the period's uncommitted buffer
3. Raise the target — the plan now allows more
4. **Leave it as it is** — always available, and a perfectly valid answer

Moving money between envelopes leaves **Safe to spend unchanged**, which is what makes
reallocation safe to experiment with. Note that "move" redistributes your *plan*; no money
moves between accounts.

---

## 8. Business workspaces

Business keeps **per-client spend caps**, unchanged, and gets no plan. This is a product
decision rather than a technical limit:

- Business revenue has no single figure — it is per client, and already modelled by
  clients, quotations and `/analytics`.
- "Safe to spend" is a daily personal question. A business asks "is this client
  profitable?", which analytics answers.
- v1's business budgets were per-client cost control, which is a different thing from the
  household equation.

Business caps are repaired but not redesigned, and their alerts continue to work.

---

## 9. Notifications

Budget notifications sit in the single **budget** category, so one preference toggle governs
all of them:

| Notification | When |
|---|---|
| Almost used up / exceeded | A cap crosses 80% / 100% |
| Payments overdue | One digest per day while anything is overdue |
| Category over its target | Once per category per period |
| Contribution not confirmed | A fund's contribution was missed at period close |
| Period closed | A period ended and its figures are final |
| A closed period was updated | A restatement revised a past record |

The overdue notice is a **daily digest** rather than one per bill, because an overdue bill
is a standing condition rather than a moment.

---

## 10. Privacy and history

- Every change is recorded in an append-only audit trail, and a failed audit write **blocks
  the edit** rather than being swallowed.
- Removing an envelope is a **soft** removal: its history and its snapshots stay readable.
- Renaming an envelope does not rewrite history — a closed period keeps the name it had at
  the time.

---

## 11. Coming from the old budgets

If you had a budget before, it was migrated **additively**: your old rows are untouched and
still readable, and nothing was reinterpreted.

- A **monthly** or **weekly** budget became a plan with the same cadence and the same
  amount.
- A **daily** budget became a monthly plan with a **per-day** target, so "€20 a day" still
  means €20 a day.
- A **lifetime** budget has no equivalent — it tracked everything you had ever spent. It
  was migrated **paused**, tracking nothing, and the app asks whether you want a monthly
  target or to keep it as a record. A €10,000 lifetime cap silently becoming a €10,000
  *monthly* budget would have been a serious misrepresentation.
- If your old target happened to match your income closely, the app asks once whether that
  figure was your **income** or your **spending target** — because the old budget had
  nowhere to record earnings, and guessing would be worse than asking.
- If you never had a budget, nothing was created.

Old `/budgets/...` links still work.

---

## 12. Limits, stated plainly

The app reports these rather than pretending otherwise:

- **Credit cards** are not modelled as liabilities yet.
- **Pending / uncleared** transactions are not distinguished from settled ones.
- A **loan payment** is not split into principal and interest.
- **Multicurrency**: nothing is ever converted. Amounts in an organization are all in that
  organization's currency, and if that currency is changed after a plan was created the app
  says so rather than mixing denominations silently.
