# ProfitSync — Budgets, explained

A plain-English guide to the expense-budget feature: what a budget is, how spend is
measured, where the indicators appear, and how it all fits together for personal and
business workspaces.

> **TL;DR**
> - A **budget** is a spending target for **outgoing** (expense) transactions over a
>   rolling window (**lifetime / monthly / weekly / daily**).
> - **Business** workspaces set a budget **per client** (including the own/company client)
>   plus an optional **default** for new clients. **Personal** workspaces set one
>   **personal budget**.
> - Spend is **never stored** — it's summed live from transactions for the current window.
> - You see it as a **progress indicator** on client cards / the personal dashboard, and
>   as a **live hint** while adding an outgoing transaction ("€X left / over budget after
>   this expense"). You can also set budgets during **onboarding**.

---

## 1. The model

A budget row (`budgets` table) holds only the **target** and **cadence** — never the spend:

| Column | Meaning |
|---|---|
| `organization_id` | The workspace the budget belongs to (cascades on org delete). |
| `client_id` | The client this budget is for. **NULL** = the org-level budget: the **personal budget** for a personal org, or the **default-for-clients** template for a business org. |
| `period` | `lifetime` \| `monthly` \| `weekly` \| `daily` — the window spend is measured against. |
| `amount` | The target, `numeric(20,2)`, in the org currency. |

Two partial unique indexes keep it clean: **one budget per client**, and **one org-level
(NULL-client) budget per org**.

Setting a budget to **0** (or pressing **Remove**) deletes the row — a clean "no budget".

## 2. How spend is measured

Spend for a budget's current window = the sum of **outgoing**, **standard** (non-transfer),
**non-deleted** transactions in that window:

- **daily** → since 00:00 today (UTC)
- **weekly** → since Monday of this week
- **monthly** → since the 1st of this month
- **lifetime** → all time (no lower bound)

UTC is used to match how transaction dates are stamped. The pure logic lives in
`src/lib/budget.ts` (`periodStart`, `budgetState`) and is unit-tested. `GET /api/budgets`
computes every client's spend for all windows in **one** grouped query and returns each
budget with its current-period `spent`.

**State thresholds:** under 80% = OK (emerald), 80–100% = nearing (amber), over 100% =
over (red).

> The business **default** budget is a *template* (prefilled when you set a budget for a
> new client) — it doesn't carry a single "spent" number, so it's shown without a bar.

## 3. Where you see it

| Surface | What shows |
|---|---|
| **Client card** (`/clients`) | A progress bar with the period, "spent of amount", and "€X left / €X over". Tap to set/edit; clients without a budget show a "Set budget" affordance. The **own/company** client is just another card. |
| **Personal dashboard** (`/dashboard`, personal orgs) | A "Personal budget" card with the same indicator + a set/edit button. |
| **Add-transaction form** (outgoing) | A live line — "€X left after this expense" / "€X over budget after this expense" — as you type the amount (in both the full Add-Transaction form and the quick-add modal). |
| **Onboarding** (step 2 of 3) | Optionally set the personal budget, or the company + default budgets, alongside starting balances. |

## 4. Account-type rules

- **Personal** workspaces have no visible clients, so their budget is always **org-level**
  (`client_id NULL`); its spend is the whole workspace's outgoing.
- **Business** workspaces set a budget **per client** (incl. the own/company client) and an
  optional **default** template for clients without their own.

Gating uses the org's `account_type` (`accountTypeAllows`); the API forces a personal
org's budget to org-level.

## 5. Files

| Concern | File |
|---|---|
| Table | `budgets` in `src/lib/db/schema.ts` (migration `0033`) |
| Pure helpers (period window, state) | `src/lib/budget.ts` (+ `budget.test.ts`) |
| API (GET with live spend, POST upsert/clear) | `api/_routes/budgets.ts` (registered in `api/index.ts`) |
| Indicator + dialog | `src/components/budget/BudgetIndicator.tsx`, `BudgetDialog.tsx` |
| Personal card | `src/components/budget/PersonalBudgetCard.tsx` |
| Client cards | `src/pages/ClientsPage.tsx` |
| Tx-form hint | `src/pages/TransactionsPage.tsx`, `src/components/QuickAddModal.tsx` |
| Onboarding step | `src/components/onboarding/WealthBudgetStep.tsx` |
| Type | `Budget` in `src/lib/types.ts` |

## 6. FAQ

**Q: Does the budget block me from overspending?**
No — it's an **indicator**, not a hard limit. You can always record the expense; the UI just
warns you (amber/red) and shows how far over you are.

**Q: Are transfers or income counted?**
No. Only **outgoing** `standard` transactions count; account-to-account **transfers** and
**income** are excluded.

**Q: What's the "default for new clients"?**
A business-only template. It prefills the budget dialog when you set a budget for a client
that doesn't have one yet, so you don't retype the same target each time.

**Q: I changed a client's transactions — does the bar update?**
Yes, on the next load of the page/indicator (spend is computed live from transactions).
