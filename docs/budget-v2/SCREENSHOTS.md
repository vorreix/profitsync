# Budget v2 — what it looks like

> **Superseded on 2026-09-05.** The plan page was simplified to ONE list (groups, budgets, a
> week / month / year toggle, hide and deactivate) — see [`SIMPLE.md`](./SIMPLE.md). Sections 2–4
> below show the earlier five-section page and the bills / savings / refund cards, which are no
> longer laid out on the page. The wizard (§1) and the scope gate (§6) are unchanged.

A screenshot walkthrough of everything built for the Smart Hybrid Budget (Phases 0–4), captured from a real browser against a seeded development database. Phone shots are 430 px wide; desktop is 1440 px.

The design rules these screens follow, and the financial invariants behind the numbers, are in [`docs/budget/BUDGETS.md`](../budget/BUDGETS.md) (the human explainer) and [`docs/budget-v2/PHASE2.md`](./PHASE2.md) (the build log).

## 1 — First run: the four-decision wizard

A plan is four decisions, one per screen, each with a sane default. Nothing about envelopes, rollover or reservations is asked here — those are all reachable later, and none of them are needed to have a working plan on day one.

### Wizard step 1 planning period

First run: one decision per screen, with a default already chosen.

<img src="./screenshots/01-wizard-step-1-planning-period.png" alt="Wizard step 1 planning period" width="380">

### Wizard step 2 expected income

Money coming in. Skippable, because the plan still works without it.

<img src="./screenshots/02-wizard-step-2-expected-income.png" alt="Wizard step 2 expected income" width="380">

### Wizard step 3 one spending target

ONE overall target. That alone is a complete plan for a beginner.

<img src="./screenshots/03-wizard-step-3-one-spending-target.png" alt="Wizard step 3 one spending target" width="380">

### Wizard step 4 review

What it will do, before it does it. Abandoned here, so no plan was created.

<img src="./screenshots/04-wizard-step-4-review.png" alt="Wizard step 4 review" width="380">

## 2 — The plan

Everything below is one page. The order is deliberate: what you can spend, then what needs your attention, then the sections, then what is left over.

### Safe to spend hero

The four numbers. Safe-to-spend also names WHICH limit is binding.

<img src="./screenshots/05-safe-to-spend-hero.png" alt="Safe to spend hero" width="380">

### Whole plan on a phone

Everything in one scroll: hero, overdue, refunds, sections, savings.

<img src="./screenshots/06-whole-plan-on-a-phone.png" alt="Whole plan on a phone" width="380">

### Safe to spend explainer

Teaches that TWO limits apply, and shows which one bit.

<img src="./screenshots/07-safe-to-spend-explainer.png" alt="Safe to spend explainer" width="380">

### Overdue bills carried forward

An unpaid bill keeps its reservation across periods instead of quietly vanishing, and says how late it is.

<img src="./screenshots/08-overdue-bills-carried-forward.png" alt="Overdue bills carried forward" width="380">

### Refunds to review

Money-in sharing a category is treated as a refund provisionally, and you can say it is not one.

<img src="./screenshots/09-refunds-to-review.png" alt="Refunds to review" width="380">

### Everyday spending with icons and bars

Per-category icon, a used/left bar, drag handles, and an inline way out of an overspend.

<img src="./screenshots/10-everyday-spending-with-icons-and-bars.png" alt="Everyday spending with icons and bars" width="380">

### Income

Expected against received, so the plan knows what has actually arrived.

<img src="./screenshots/11-income.png" alt="Income" width="380">

### Bills

Bills read PAID and UNPAID. Only everyday spending can be over.

<img src="./screenshots/12-bills.png" alt="Bills" width="380">

### Debt

A debt payment reduces what you owe. It is never mixed into spending.

<img src="./screenshots/13-debt.png" alt="Debt" width="380">

### Savings funds

Goal progress, a suggested pace, and a contribution you confirm rather than one assumed for you.

<img src="./screenshots/14-savings-funds.png" alt="Savings funds" width="380">

### Unallocated

What the plan has not committed. This is where a cover-from-unallocated comes out of.

<img src="./screenshots/15-unallocated.png" alt="Unallocated" width="380">

## 3 — Categories: add, edit, delete

One dialog does create and edit, so the two cannot drift apart. Delete lives in it too, behind a two-tap confirm, on the left of the footer where it will not be hit by accident.

### Add a spending category

Name, icon, target, categories. Save stays disabled until a category is picked.

<img src="./screenshots/16-add-a-spending-category.png" alt="Add a spending category" width="380">

### Icon suggested from the name

Typing Coffee suggests the dining glyph. Pick one yourself and it never fights you again.

<img src="./screenshots/17-icon-suggested-from-the-name.png" alt="Icon suggested from the name" width="380">

### Edit a category

The same dialog edits. Icon grid, target, and the category chips it claims.

<img src="./screenshots/18-edit-a-category.png" alt="Edit a category" width="380">

### The last category cannot be removed

Emptying it would silently stop counting spend it counted yesterday. Refused, with the reason said out loud.

<img src="./screenshots/19-the-last-category-cannot-be-removed.png" alt="The last category cannot be removed" width="380">

## 4 — Acting on what the page tells you

Every number that reports a problem also offers the way out of it, in place, without leaving the page.

### Ways out of an overspend

The ORDER is the advice: cheapest and least disruptive first. Accepting the overspend is always one of the options.

<img src="./screenshots/20-ways-out-of-an-overspend.png" alt="Ways out of an overspend" width="380">

### Category detail and history

Every transaction that landed here, plus what changed about the envelope and when.

<img src="./screenshots/21-category-detail-and-history.png" alt="Category detail and history" width="380">

### Add a bill

One-time or repeating, with a due date. An occurrence is an EXPECTATION, not a payment.

<img src="./screenshots/22-add-a-bill.png" alt="Add a bill" width="380">

## 5 — Desktop

The same page in the sidebar shell.

### Desktop plan

The same page inside the sidebar shell.

<img src="./screenshots/23-desktop-plan.png" alt="Desktop plan" width="900">

### Desktop plan full page

Every section at once, at desktop width.

<img src="./screenshots/24-desktop-plan-full-page.png" alt="Desktop plan full page" width="900">

## 6 — The scope gate

A household plan is personal-only. This is not merely scope: a business workspace's `budgets` rows ARE its per-client spend caps, so serving it the household plan would replace a feature it is already using.

### Business workspace is bounced

A business workspace keeps its per-client spend caps instead of a household plan. /budgets landed on /dashboard.

<img src="./screenshots/25-business-workspace-is-bounced.png" alt="Business workspace is bounced" width="900">

### Per-client spend caps still work

The v1 business feature the gate exists to protect, untouched.

<img src="./screenshots/26-per-client-spend-caps-still-work.png" alt="Per-client spend caps still work" width="900">

---

Captured with a throwaway Playwright script against a seeded development database, with a deliberately messy month: a category taken over its target three different ways, spend in a category no envelope claims, spend with no category at all, an invoice overdue since 2024, a fund part-way to its goal, and two money-in entries that look like refunds. No production or shared data was touched.
