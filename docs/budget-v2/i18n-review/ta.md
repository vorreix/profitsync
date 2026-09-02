# Budget v2 — Tamil (தமிழ்) translation review

Paste everything below into ChatGPT (or hand it to a native speaker).

---

You are reviewing the Tamil (தமிழ்) strings for the budgeting screen of
ProfitSync, a personal-finance app. The strings are **already translated**. Your
job is **not** to retranslate them — it is to judge whether they are correct,
natural, and whether the distinctions between them survive.

## Why this matters

This budgeting feature exists because ordinary budget apps blur money words
together. Its whole design depends on several ideas staying **visibly
different** from each other:

- **reserved** (still in the account, held back for a bill) vs **spent** (gone)
- **planned** (intent) vs **spent** vs **pending** (owed, not yet paid) vs **remaining**
- **set aside** (confirmed) vs **reserved but not yet confirmed**
- **safe to spend** (the smaller of two limits) vs **available cash**
- **unpaid** (a bill awaiting payment) vs **over** (a target exceeded)

If two of these read the same way in Tamil (தமிழ்), the feature stops working
for Tamil (தமிழ்) users, even though every individual word is defensible.

## Tone

The copy is deliberately **factual and non-judgemental**. It states what
happened and offers options. It never scolds the user for overspending, never
implies fault, and never uses alarming language. Please preserve that.

## Mechanics you must not break

1. Every `{{placeholder}}` must appear in your output **exactly** as in the
   English, spelled identically. A missing or renamed placeholder fails our
   automated check and blocks the release.
2. Do not add or remove keys.
3. Keys ending `_one` / `_other` are plural variants. If Tamil (தமிழ்) needs
   different plural handling, say so in prose — do not invent new key suffixes.

## The terms

For each row: the key, the English source, the current Tamil (தமிழ்) string,
and **what it must not be confused with**.

### `safeToSpend`
- **English:** Safe to spend
- **Current ta:** பாதுகாப்பான செலவு
- **Must not be confused with:** Must NOT read as 'available', 'balance' or 'remaining budget'. It is the bounded intersection of available cash and what the plan allows — the one figure that answers 'can I buy this?'

### `availableNow`
- **English:** Available now
- **Current ta:** இப்போது கிடைக்கும்
- **Must not be confused with:** Raw liquid cash BEFORE any money is held back. Must read differently from safeToSpend.

### `reserved`
- **English:** Reserved
- **Current ta:** ஒதுக்கப்பட்டது
- **Must not be confused with:** Must NOT read as 'spent'. The money has NOT left the account; it is held back for bills, debt and savings.

### `forecast`
- **English:** Forecast balance
- **Current ta:** எதிர்பார்க்கப்படும் இருப்பு
- **Must not be confused with:** A projection to the end of the period, not a current figure. Must not read as availableNow.

### `fundingCapacity`
- **English:** Funding this period
- **Current ta:** இந்தக் காலத்தின் நிதி
- **Must not be confused with:** What this period has to work with. Must NOT read as 'income'. Spending never reduces it.

### `unallocated`
- **English:** Unallocated
- **Current ta:** ஒதுக்கப்படாதது
- **Must not be confused with:** A deliberate buffer that is NOT freely spendable. Must NOT read as safeToSpend or as 'left over'.

### `savingsFunded`
- **English:** Set aside
- **Current ta:** ஒதுக்கி வைக்கப்பட்டது
- **Must not be confused with:** Only CONFIRMED money may be described as 'set aside'.

### `savingsReservedNotConfirmed`
- **English:** {{amount}} reserved · not yet confirmed
- **Current ta:** {{amount}} ஒதுக்கப்பட்டது · இன்னும் உறுதிப்படுத்தப்படவில்லை
- **Must not be confused with:** Reserved but NOT yet confirmed. Must read clearly DIFFERENT from savingsFunded — this distinction is the entire point of the four contribution states.

### `pending`
- **English:** Pending
- **Current ta:** நிலுவையில்
- **Must not be confused with:** An obligation not yet paid. Must NOT read as 'spent'.

### `overdueSince`
- **English:** Overdue since {{date}}
- **Current ta:** {{date}} முதல் தாமதம்
- **Must not be confused with:** Still owed and still reserved. Must NOT read as 'cancelled' or 'written off'.

### `stateFull`
- **English:** Fully used
- **Current ta:** முழுமையாகப் பயன்படுத்தப்பட்டது
- **Must not be confused with:** Exactly 100% used. Neither 'nearing' nor 'exceeded'.

### `bindingPlan`
- **English:** Limited by your plan — {{amount}} of cash is uncommitted
- **Current ta:** உங்கள் திட்டத்தால் வரையறுக்கப்பட்டது — {{amount}} பணம் ஒதுக்கப்படவில்லை
- **Must not be confused with:** Explains that THE PLAN was the tighter of two limits. Must read differently from bindingCash.

### `bindingCash`
- **English:** Limited by your available cash — your plan still allows {{amount}}
- **Current ta:** கிடைக்கும் பணத்தால் வரையறுக்கப்பட்டது — திட்டம் இன்னும் {{amount}} அனுமதிக்கிறது
- **Must not be confused with:** Explains that AVAILABLE CASH was the tighter of two limits. Must read differently from bindingPlan.

### `bindingCashOnly`
- **English:** You haven't set a spending target, so this is the cash you have after bills.
- **Current ta:** செலவு இலக்கு அமைக்கப்படவில்லை, எனவே பில்களுக்குப் பிறகு உள்ள பணம் இது.
- **Must not be confused with:** There is no plan ceiling yet, so only cash limits spending.

### `includesRefund`
- **English:** Includes {{amount}} treated as a refund
- **Current ta:** {{amount}} திரும்பப்பெறலாகக் கருதப்படுகிறது
- **Must not be confused with:** A PROVISIONAL guess the user can correct — not a confirmed fact. The wording must convey uncertainty.

### `rejectRefund`
- **English:** Not a refund
- **Current ta:** திரும்பப்பெறல் அல்ல
- **Must not be confused with:** The user declaring it is not a refund. Must NOT read as 'delete' or 'remove the transaction'.

### `plannedShort`
- **English:** Planned
- **Current ta:** திட்டமிட்டது
- **Must not be confused with:** Intent. Must read differently from spentShort, pendingShort and remaining.

### `spentShort`
- **English:** Spent
- **Current ta:** செலவானது
- **Must not be confused with:** Money already gone. Must read differently from plannedShort and pendingShort.

### `pendingShort`
- **English:** Pending
- **Current ta:** நிலுவை
- **Must not be confused with:** Owed but still in the account. Must NOT read as spentShort.

### `remaining`
- **English:** Remaining
- **Current ta:** மீதம்
- **Must not be confused with:** What is left of the intent. Must read differently from overBy.

### `overBy`
- **English:** Over by
- **Current ta:** இதற்கு மேல்
- **Must not be confused with:** The signed counterpart of remaining — the amount by which a target was exceeded.

### `unpaidAmount`
- **English:** {{amount}} unpaid
- **Current ta:** {{amount}} செலுத்த வேண்டும்
- **Must not be confused with:** CRITICAL: must NOT be translated as 'over' or 'exceeded'. An unpaid bill is RESERVED, not overspent — a bills envelope has no target to exceed.

### `paidShort`
- **English:** Paid
- **Current ta:** செலுத்தியது
- **Must not be confused with:** A bill was settled. Distinct from ordinary spending (spentShort).

### `overdueShort`
- **English:** Overdue
- **Current ta:** தாமதம்
- **Must not be confused with:** Late but still owed and still reserved. Factual, never accusatory.

### `daysOverdue`
- **English:** {{count}} days late
- **Current ta:** {{count}} நாட்கள் தாமதம்
- **Must not be confused with:** Neutral statement of lateness. Has _one/_other plural forms; keep {{count}}.

### `needsAttentionShort`
- **English:** Several payments in a row are unpaid — worth a look.
- **Current ta:** தொடர்ச்சியாக பல கட்டணங்கள் செலுத்தப்படவில்லை — ஒருமுறை பாருங்கள்.
- **Must not be confused with:** Several payments in a row are unpaid, so the RULE is probably wrong (a cancelled subscription). An invitation to look, not a reprimand.

### `leftoverTag`
- **English:** leftover
- **Current ta:** மீதம்
- **Must not be confused with:** Tags the catch-all envelope, which claims EVERYTHING not claimed by a named category. Not 'other' or 'miscellaneous'.

### `uncategorisedNote`
- **English:** {{amount}} was not in any category you track.
- **Current ta:** {{amount}} நீங்கள் கண்காணிக்கும் எந்த வகையிலும் இல்லை.
- **Must not be confused with:** The money IS tracked — by the leftover envelope. This says only that it matched no NAMED category. Must not read as 'untracked' or 'ignored'.

### `categoryTaken`
- **English:** Already tracked by another envelope
- **Current ta:** மற்றொரு பிரிவில் ஏற்கனவே உள்ளது
- **Must not be confused with:** This category already belongs to a different envelope. Each category belongs to exactly one.

### `envelopeCategoriesHint`
- **English:** Spending in these categories counts here. Each category belongs to one envelope only.
- **Current ta:** இந்த வகைகளின் செலவு இங்கே கணக்கிடப்படும். ஒரு வகை ஒரே ஒரு பிரிவுக்கு மட்டுமே.
- **Must not be confused with:** Explains the one-category-one-envelope rule. The rule must survive the translation.

### `overspendTitle`
- **English:** {{name}} is over its target
- **Current ta:** {{name}} இலக்கைத் தாண்டியுள்ளது
- **Must not be confused with:** States a fact about a target being exceeded. Neutral.

### `overspendBody`
- **English:** You planned {{planned}} and have spent {{spent}}, so this is {{amount}} over. Here is how you can cover it.
- **Current ta:** {{planned}} திட்டமிட்டீர்கள், {{spent}} செலவானது — அதாவது {{amount}} அதிகம். ஈடுசெய்ய வழிகள் இவை.
- **Must not be confused with:** States three numbers and offers help. Must contain NO reproach — no 'unfortunately', no 'you should have'.

### `moveFrom`
- **English:** Move from {{name}}
- **Current ta:** {{name}} இலிருந்து நகர்த்து
- **Must not be confused with:** CRITICAL: must NOT borrow the app's account-transfer verb. NO money moves between accounts — only the plan's intent is redistributed.

### `coverFromUnallocated`
- **English:** Use unallocated money
- **Current ta:** ஒதுக்கப்படாத பணத்தைப் பயன்படுத்து
- **Must not be confused with:** Uses the period's uncommitted buffer. NOT savings, NOT a fund.

### `raiseTarget`
- **English:** Raise this target
- **Current ta:** இந்த இலக்கை உயர்த்து
- **Must not be confused with:** The plan decides to allow more. Nothing is added; no money appears.

### `acceptOverspend`
- **English:** Leave it as it is
- **Current ta:** இப்படியே விடு
- **Must not be confused with:** CRITICAL: accepting a known overspend is a VALID choice. Must NOT read as the wrong answer, nor as 'ignore' or 'dismiss'.

### `overspendInline`
- **English:** You have options for covering this.
- **Current ta:** இதை ஈடுசெய்ய வழிகள் உள்ளன.
- **Must not be confused with:** A calm pointer that options exist.

### `partiallySettled`
- **English:** {{settled}} refunded, {{outstanding}} still outstanding
- **Current ta:** {{settled}} திரும்பக் கிடைத்தது, {{outstanding}} இன்னும் நிலுவை
- **Must not be confused with:** Money coming BACK, partly. Must read differently from fullySettled and from 'paid'.

### `fullySettled`
- **English:** Fully refunded ({{amount}})
- **Current ta:** முழுமையாகத் திரும்பக் கிடைத்தது ({{amount}})
- **Must not be confused with:** Money coming BACK, in full.

### `confirmedSettlement`
- **English:** Confirmed refund
- **Current ta:** உறுதிசெய்யப்பட்ட திரும்பப்பணம்
- **Must not be confused with:** A STATED FACT, as opposed to includesRefund which is a guess. The two must read differently.

### `billOneTime`
- **English:** One-off
- **Current ta:** ஒரு முறை
- **Must not be confused with:** A single due date, tracked only by the budget.

### `billRecurring`
- **English:** Recurring
- **Current ta:** தொடர்ச்சியான
- **Must not be confused with:** LINKS an existing recurring expense, which keeps control of the amount and the schedule. Must read differently from billOneTime.

### `billRecurringNote`
- **English:** The recurring expense stays in charge of the amount and the schedule. It is marked paid automatically when it posts.
- **Current ta:** தொகையையும் அட்டவணையையும் தொடர் செலவே தீர்மானிக்கும். அது பதிவாகும்போது இது தானாகவே செலுத்தியதாகக் குறிக்கப்படும்.
- **Must not be confused with:** Explains that the recurring expense stays in charge and is marked paid automatically. That meaning must survive.

### `wasNamed`
- **English:** was {{name}}
- **Current ta:** {{name}} ஆக இருந்தது
- **Must not be confused with:** The name AS AT the close of a past period. History is not rewritten by a later rename.

### `restated`
- **English:** Restated
- **Current ta:** மீள்கூறப்பட்டது
- **Must not be confused with:** The audited, LEGITIMATE way a closed period is revised. Must NOT read as 'wrong', 'error' or 'corrected mistake'.

## What to give back

1. A short prose note on anything that is **wrong, unnatural, or ambiguous** —
   especially any two terms that currently read too much alike.
2. Then a JSON object containing **only the keys you changed**, in exactly this
   shape (this is fed straight into our merge tool, so no extra nesting, no
   comments, no trailing commas):

```json
{
  "ta": {
    "budgetV2.<key>": "<corrected ta string>"
  }
}
```

If a string is already right, **leave it out**. A short, targeted diff is far
more useful than a full retranslation.

---

## How the corrections get applied (for the developer)

```bash
# save the JSON block as corrections.json, then:
node scripts/i18n-merge.mjs corrections.json
npm run i18n:check
```
