# Budget v2 — translation review list

> **Phase 1:** 107 keys under `budgetV2` in all 8 locales (856 strings).
> **Phase 2:** a further 101 keys (808 strings), bringing `budgetV2` to 208 keys
> and the project total to 1871 per locale. Verified: all 175 keys the Budget v2
> components reference resolve, and **no** non-English locale leaves any of them
> identical to the English string.
>
> These exist so the `i18n:check` gate passes and no English leaks into a
> non-English UI. The
> Romance/Germanic locales (`it`, `de`) are high confidence. **The terms below
> carry specific financial meaning and should be checked by a native speaker
> before release**, particularly for `hi`, `ml`, `ta`, `te` and `ar`.

## Why these specific terms

Budget v2's whole point is that several money words mean *different* things and
must not be conflated (spec §7). A translation that blurs them reintroduces
exactly the confusion the redesign removes.

| Key | English | What it must NOT be confused with |
|---|---|---|
| `safeToSpend` | Safe to spend | *Available* / *balance* / *remaining budget*. This is the bounded intersection of cash and plan — the only figure that answers "can I buy this?" |
| `availableNow` | Available now | *Safe to spend*. This is raw liquid cash before any reservation. |
| `reserved` | Reserved | *Spent*. The money has **not** left the account; it is held back for bills, debt and savings. |
| `forecast` | Forecast balance | *Available now*. A projection to the period end, not a current figure. |
| `fundingCapacity` / `fundingBase` | Funding this period / Starting balance | *Income*. Capacity is what the period has to work with; spending never reduces it. |
| `unallocated` | Unallocated | *Safe to spend*. A buffer that is deliberately **not** spendable without an explicit decision. |
| `savingsFunded` vs `savingsReservedNotConfirmed` | Set aside vs reserved · not yet confirmed | Each other. **Only a confirmed contribution may be described as "set aside"** (§8.9.1) — this distinction is the point of the four contribution states, so the two strings must read as clearly different. |
| `pending` | Pending | *Spent*. An expected obligation that has not been paid. |
| `overdueSince` / `overdueTitle` | Overdue | *Cancelled* / *written off*. An overdue obligation is **still owed and still reserved**. |
| `stateFull` | Fully used | *Over target*. Exactly 100 % is neither "nearing" nor "exceeded". |
| `bindingPlan` / `bindingCash` / `bindingCashOnly` | Limited by your plan / cash | Each other. These explain *which of two* limits applied; if they read the same, the explanation is lost. |
| `includesRefund` / `rejectRefund` | Treated as a refund / Not a refund | A confirmed fact. The wording must convey that this is a **provisional guess** the user can correct (§8.8). |

## Phase 2 terms

Phase 2 introduces categories, obligations and refund review, and with them a
second set of distinctions that must not blur.

| Key | English | What it must NOT be confused with |
|---|---|---|
| `plannedShort` / `spentShort` / `pendingShort` / `remaining` | Planned · Spent · Pending · Remaining | **Each other.** These are the four figures a category card shows, and the whole card is unreadable if any two read alike. *Planned* is intent, *spent* is money gone, *pending* is money owed but still here, *remaining* is what is left of the intent. |
| `unpaidAmount` | {{amount}} unpaid | *Over.* An unpaid bill is **reserved**, not overspent — a commitment envelope has no target to exceed. Translating this as "over" or "exceeded" reintroduces the exact confusion §8.7 removes. |
| `paidShort` | Paid | *Spent.* Used for obligations: a bill was settled. Distinct from flexible spending. |
| `overdueShort` / `daysOverdue` | Overdue · {{count}} days late | *Cancelled.* Still owed, still reserved. Factual, not accusatory. |
| `overBy` | Over by | *Remaining.* The signed counterpart — the detail sheet swaps one label for the other, so they must be visibly different. |
| `leftoverTag` | leftover | *Other* / *miscellaneous*. This tags the catch-all envelope, which claims **everything not claimed by another category**. |
| `uncategorisedNote` | {{amount}} was not in any category you track | *Untracked* / *ignored*. The money **is** tracked — by the leftover envelope. This says only that it matched no named category. |
| `overspendTitle` / `overspendBody` | is over its target · you planned X and have spent Y | A rebuke. This copy states three numbers and offers options. Please keep it neutral (principle P7) — no "unfortunately", no "you should have". |
| `acceptOverspend` | Leave it as it is | *Ignore* / *dismiss*. Accepting a known overspend is a **valid plan state**, and this option must not read as the wrong answer. |
| `coverFromUnallocated` | Use unallocated money | *Use savings.* Unallocated is the period's uncommitted buffer, not a fund. |
| `raiseTarget` / `raiseTargetHint` | Raise this target | *Add money.* Nothing is added; the plan simply decides to allow more. |
| `moveFrom` / `hasAvailable` | Move from {{name}} · {{amount}} available | *Transfer.* No money moves between accounts — only the **plan's** intent is redistributed. Using the app's account-transfer verb here would be actively misleading. |
| `refundReviewTitle` / `refundReviewBody` | look like refunds · tell us if that is wrong | A confirmed fact. The wording must convey a **provisional guess** the user is invited to correct. |
| `rejectRefund` | Not a refund | *Delete* / *exclude.* The transaction is untouched; only its budget treatment changes. |
| `partiallySettled` / `fullySettled` | X refunded, Y still outstanding | Each other, and *paid*. This describes money coming **back**, not going out. |
| `confirmedSettlement` | Confirmed refund | `includesRefund` (the provisional guess). One is a stated fact, the other a guess. |
| `billOneTime` / `billRecurring` | One-off · Recurring | Each other. A recurring bill **links an existing recurring expense** which keeps control of amount and schedule; a one-off is budget-only. `billRecurringNote` explains this and its meaning must survive. |
| `wasNamed` | was {{name}} | A rename. This appears in history to show the name **as at close** — history is not rewritten by a later rename. |
| `restated` | Restated | *Corrected* / *wrong.* A restatement is the audited, legitimate way a closed period is revised. |

## Tone

The copy is deliberately **factual and non-judgmental** (principle P7): it states
the fact and the options, never scolds. Please preserve that — e.g.
`savingsMissed` ("Not confirmed, so it wasn't set aside") should read as a
neutral observation, not a reproach, and `negativeSafe` should inform rather than
alarm.

## Mechanics to preserve

- Every `{{placeholder}}` must survive verbatim — `i18n:check` fails the commit otherwise.
- `daysLeft`, `savingsAwaiting`, `overdueTitle`, `daysOverdue` and `refundReviewTitle` have `_one` / `_other` plural pairs. Only those two suffixes exist anywhere in this codebase; adding `_few`/`_many` requires adding them to **all** locales.
- `ar` is RTL. Copy was written to avoid embedded LTR fragments, but please check that amounts and dates read naturally in context.

## How to apply corrections

```bash
# 1. Put corrections in a flat map: { "<lang>": { "budgetV2.<key>": "<text>" } }
node scripts/i18n-merge.mjs /path/to/corrections.json
# 2. Verify parity
npm run i18n:check
```

`i18n-merge.mjs` is additive and order-preserving, so it will not disturb any
other key.
