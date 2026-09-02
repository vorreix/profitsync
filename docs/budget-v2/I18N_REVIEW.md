# Budget v2 — translation review list

> 107 keys under `budgetV2` were added to all 8 locales (856 strings) so the
> `i18n:check` gate passes and no English leaks into a non-English UI. The
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

## Tone

The copy is deliberately **factual and non-judgmental** (principle P7): it states
the fact and the options, never scolds. Please preserve that — e.g.
`savingsMissed` ("Not confirmed, so it wasn't set aside") should read as a
neutral observation, not a reproach, and `negativeSafe` should inform rather than
alarm.

## Mechanics to preserve

- Every `{{placeholder}}` must survive verbatim — `i18n:check` fails the commit otherwise.
- `daysLeft`, `savingsAwaiting`, `overdueTitle` have `_one` / `_other` plural pairs. Only those two suffixes exist anywhere in this codebase; adding `_few`/`_many` requires adding them to **all** locales.
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
