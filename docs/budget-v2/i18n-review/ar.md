# Budget v2 — Arabic (العربية) translation review

Paste everything below into ChatGPT (or hand it to a native speaker).

---

You are reviewing the Arabic (العربية) strings for the budgeting screen of
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

If two of these read the same way in Arabic (العربية), the feature stops working
for Arabic (العربية) users, even though every individual word is defensible.

## Tone

The copy is deliberately **factual and non-judgemental**. It states what
happened and offers options. It never scolds the user for overspending, never
implies fault, and never uses alarming language. Please preserve that.

## Direction

Arabic is right-to-left. Copy was written to avoid embedded left-to-right
fragments, but please check that amounts, dates and numbers read naturally in
context.

## Mechanics you must not break

1. Every `{{placeholder}}` must appear in your output **exactly** as in the
   English, spelled identically. A missing or renamed placeholder fails our
   automated check and blocks the release.
2. Do not add or remove keys.
3. Keys ending `_one` / `_other` are plural variants. If Arabic (العربية) needs
   different plural handling, say so in prose — do not invent new key suffixes.

## The terms

For each row: the key, the English source, the current Arabic (العربية) string,
and **what it must not be confused with**.

### `safeToSpend`
- **English:** Safe to spend
- **Current ar:** آمن للإنفاق
- **Must not be confused with:** Must NOT read as 'available', 'balance' or 'remaining budget'. It is the bounded intersection of available cash and what the plan allows — the one figure that answers 'can I buy this?'

### `availableNow`
- **English:** Available now
- **Current ar:** المتاح الآن
- **Must not be confused with:** Raw liquid cash BEFORE any money is held back. Must read differently from safeToSpend.

### `reserved`
- **English:** Reserved
- **Current ar:** محتجز
- **Must not be confused with:** Must NOT read as 'spent'. The money has NOT left the account; it is held back for bills, debt and savings.

### `forecast`
- **English:** Forecast balance
- **Current ar:** الرصيد المتوقع
- **Must not be confused with:** A projection to the end of the period, not a current figure. Must not read as availableNow.

### `fundingCapacity`
- **English:** Funding this period
- **Current ar:** تمويل هذه الفترة
- **Must not be confused with:** What this period has to work with. Must NOT read as 'income'. Spending never reduces it.

### `unallocated`
- **English:** Unallocated
- **Current ar:** غير مخصص
- **Must not be confused with:** A deliberate buffer that is NOT freely spendable. Must NOT read as safeToSpend or as 'left over'.

### `savingsFunded`
- **English:** Set aside
- **Current ar:** تم تجنيبه
- **Must not be confused with:** Only CONFIRMED money may be described as 'set aside'.

### `savingsReservedNotConfirmed`
- **English:** {{amount}} reserved · not yet confirmed
- **Current ar:** {{amount}} محتجزة · لم تُؤكَّد بعد
- **Must not be confused with:** Reserved but NOT yet confirmed. Must read clearly DIFFERENT from savingsFunded — this distinction is the entire point of the four contribution states.

### `pending`
- **English:** Pending
- **Current ar:** معلّق
- **Must not be confused with:** An obligation not yet paid. Must NOT read as 'spent'.

### `overdueSince`
- **English:** Overdue since {{date}}
- **Current ar:** متأخرة منذ {{date}}
- **Must not be confused with:** Still owed and still reserved. Must NOT read as 'cancelled' or 'written off'.

### `stateFull`
- **English:** Fully used
- **Current ar:** استُخدم كاملًا
- **Must not be confused with:** Exactly 100% used. Neither 'nearing' nor 'exceeded'.

### `bindingPlan`
- **English:** Limited by your plan — {{amount}} of cash is uncommitted
- **Current ar:** محدود بخطتك — {{amount}} من النقد غير مُلتزم به
- **Must not be confused with:** Explains that THE PLAN was the tighter of two limits. Must read differently from bindingCash.

### `bindingCash`
- **English:** Limited by your available cash — your plan still allows {{amount}}
- **Current ar:** محدود بالنقد المتاح — خطتك تسمح بـ {{amount}} إضافية
- **Must not be confused with:** Explains that AVAILABLE CASH was the tighter of two limits. Must read differently from bindingPlan.

### `bindingCashOnly`
- **English:** You haven't set a spending target, so this is the cash you have after bills.
- **Current ar:** لم تحدّد هدفًا للإنفاق، لذا هذا هو النقد المتبقي بعد الفواتير.
- **Must not be confused with:** There is no plan ceiling yet, so only cash limits spending.

### `includesRefund`
- **English:** Includes {{amount}} treated as a refund
- **Current ar:** يشمل {{amount}} تُعتبر مبلغًا مُعادًا
- **Must not be confused with:** A PROVISIONAL guess the user can correct — not a confirmed fact. The wording must convey uncertainty.

### `rejectRefund`
- **English:** Not a refund
- **Current ar:** ليس مبلغًا مُعادًا
- **Must not be confused with:** The user declaring it is not a refund. Must NOT read as 'delete' or 'remove the transaction'.

### `plannedShort`
- **English:** Planned
- **Current ar:** المخطط
- **Must not be confused with:** Intent. Must read differently from spentShort, pendingShort and remaining.

### `spentShort`
- **English:** Spent
- **Current ar:** المنفق
- **Must not be confused with:** Money already gone. Must read differently from plannedShort and pendingShort.

### `pendingShort`
- **English:** Pending
- **Current ar:** قيد الاستحقاق
- **Must not be confused with:** Owed but still in the account. Must NOT read as spentShort.

### `remaining`
- **English:** Remaining
- **Current ar:** المتبقي
- **Must not be confused with:** What is left of the intent. Must read differently from overBy.

### `overBy`
- **English:** Over by
- **Current ar:** تجاوز بمقدار
- **Must not be confused with:** The signed counterpart of remaining — the amount by which a target was exceeded.

### `unpaidAmount`
- **English:** {{amount}} unpaid
- **Current ar:** {{amount}} غير مسدد
- **Must not be confused with:** CRITICAL: must NOT be translated as 'over' or 'exceeded'. An unpaid bill is RESERVED, not overspent — a bills envelope has no target to exceed.

### `paidShort`
- **English:** Paid
- **Current ar:** مسدد
- **Must not be confused with:** A bill was settled. Distinct from ordinary spending (spentShort).

### `overdueShort`
- **English:** Overdue
- **Current ar:** متأخر
- **Must not be confused with:** Late but still owed and still reserved. Factual, never accusatory.

### `daysOverdue`
- **English:** {{count}} days late
- **Current ar:** متأخر {{count}} يومًا
- **Must not be confused with:** Neutral statement of lateness. Has _one/_other plural forms; keep {{count}}.

### `needsAttentionShort`
- **English:** Several payments in a row are unpaid — worth a look.
- **Current ar:** عدة دفعات متتالية غير مسددة — يستحق الأمر مراجعة.
- **Must not be confused with:** Several payments in a row are unpaid, so the RULE is probably wrong (a cancelled subscription). An invitation to look, not a reprimand.

### `leftoverTag`
- **English:** leftover
- **Current ar:** المتبقي
- **Must not be confused with:** Tags the catch-all envelope, which claims EVERYTHING not claimed by a named category. Not 'other' or 'miscellaneous'.

### `uncategorisedNote`
- **English:** {{amount}} was not in any category you track.
- **Current ar:** {{amount}} لم يكن في أي فئة تتابعها.
- **Must not be confused with:** The money IS tracked — by the leftover envelope. This says only that it matched no NAMED category. Must not read as 'untracked' or 'ignored'.

### `categoryTaken`
- **English:** Already tracked by another envelope
- **Current ar:** مُتابَعة بالفعل في بند آخر
- **Must not be confused with:** This category already belongs to a different envelope. Each category belongs to exactly one.

### `envelopeCategoriesHint`
- **English:** Spending in these categories counts here. Each category belongs to one envelope only.
- **Current ar:** الإنفاق في هذه الفئات يُحسب هنا. كل فئة تنتمي إلى بند واحد فقط.
- **Must not be confused with:** Explains the one-category-one-envelope rule. The rule must survive the translation.

### `overspendTitle`
- **English:** {{name}} is over its target
- **Current ar:** {{name}} تجاوز هدفه
- **Must not be confused with:** States a fact about a target being exceeded. Neutral.

### `overspendBody`
- **English:** You planned {{planned}} and have spent {{spent}}, so this is {{amount}} over. Here is how you can cover it.
- **Current ar:** خططت لـ {{planned}} وأنفقت {{spent}}، أي تجاوز بمقدار {{amount}}. إليك طرق التغطية.
- **Must not be confused with:** States three numbers and offers help. Must contain NO reproach — no 'unfortunately', no 'you should have'.

### `moveFrom`
- **English:** Move from {{name}}
- **Current ar:** النقل من {{name}}
- **Must not be confused with:** CRITICAL: must NOT borrow the app's account-transfer verb. NO money moves between accounts — only the plan's intent is redistributed.

### `coverFromUnallocated`
- **English:** Use unallocated money
- **Current ar:** استخدام المال غير المخصص
- **Must not be confused with:** Uses the period's uncommitted buffer. NOT savings, NOT a fund.

### `raiseTarget`
- **English:** Raise this target
- **Current ar:** رفع هذا الهدف
- **Must not be confused with:** The plan decides to allow more. Nothing is added; no money appears.

### `acceptOverspend`
- **English:** Leave it as it is
- **Current ar:** اتركه كما هو
- **Must not be confused with:** CRITICAL: accepting a known overspend is a VALID choice. Must NOT read as the wrong answer, nor as 'ignore' or 'dismiss'.

### `overspendInline`
- **English:** You have options for covering this.
- **Current ar:** لديك خيارات لتغطية ذلك.
- **Must not be confused with:** A calm pointer that options exist.

### `partiallySettled`
- **English:** {{settled}} refunded, {{outstanding}} still outstanding
- **Current ar:** {{settled}} مُسترد، و{{outstanding}} لا يزال مستحقًا
- **Must not be confused with:** Money coming BACK, partly. Must read differently from fullySettled and from 'paid'.

### `fullySettled`
- **English:** Fully refunded ({{amount}})
- **Current ar:** مُسترد بالكامل ({{amount}})
- **Must not be confused with:** Money coming BACK, in full.

### `confirmedSettlement`
- **English:** Confirmed refund
- **Current ar:** مبلغ مُسترد مؤكد
- **Must not be confused with:** A STATED FACT, as opposed to includesRefund which is a guess. The two must read differently.

### `billOneTime`
- **English:** One-off
- **Current ar:** لمرة واحدة
- **Must not be confused with:** A single due date, tracked only by the budget.

### `billRecurring`
- **English:** Recurring
- **Current ar:** متكررة
- **Must not be confused with:** LINKS an existing recurring expense, which keeps control of the amount and the schedule. Must read differently from billOneTime.

### `billRecurringNote`
- **English:** The recurring expense stays in charge of the amount and the schedule. It is marked paid automatically when it posts.
- **Current ar:** يبقى المصروف المتكرر هو المسؤول عن المبلغ والجدول. ويُحدَّد كمسدد تلقائيًا عند تسجيله.
- **Must not be confused with:** Explains that the recurring expense stays in charge and is marked paid automatically. That meaning must survive.

### `wasNamed`
- **English:** was {{name}}
- **Current ar:** كان {{name}}
- **Must not be confused with:** The name AS AT the close of a past period. History is not rewritten by a later rename.

### `restated`
- **English:** Restated
- **Current ar:** مُعاد بيانه
- **Must not be confused with:** The audited, LEGITIMATE way a closed period is revised. Must NOT read as 'wrong', 'error' or 'corrected mistake'.

## What to give back

1. A short prose note on anything that is **wrong, unnatural, or ambiguous** —
   especially any two terms that currently read too much alike.
2. Then a JSON object containing **only the keys you changed**, in exactly this
   shape (this is fed straight into our merge tool, so no extra nesting, no
   comments, no trailing commas):

```json
{
  "ar": {
    "budgetV2.<key>": "<corrected ar string>"
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
