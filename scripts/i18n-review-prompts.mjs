// Generates one ready-to-paste native-review prompt per locale for the Budget v2
// terms that carry specific financial meaning (docs/budget-v2/I18N_REVIEW.md).
//
// The point of these prompts is NOT "translate this list". The strings are
// already translated. What needs a native speaker is whether the DISTINCTIONS
// survive — whether "reserved" still reads differently from "spent", whether
// "unpaid" does not read as "over", whether the tone is factual rather than
// scolding. So each term ships with the confusion it must avoid, and the
// reviewer is asked to change only what is actually wrong.
//
//   node scripts/i18n-review-prompts.mjs            # all five locales
//   node scripts/i18n-review-prompts.mjs hi ar      # just these
//
// Output: docs/budget-v2/i18n-review/<lang>.md
import fs from "node:fs"
import path from "node:path"

const LOCALES = {
  hi: "Hindi (हिन्दी)",
  ml: "Malayalam (മലയാളം)",
  ta: "Tamil (தமிழ்)",
  te: "Telugu (తెలుగు)",
  ar: "Arabic (العربية)",
}

/** key → what the translation must NOT be confused with. */
const TERMS = {
  // ── the money vocabulary the whole redesign rests on ──
  safeToSpend:
    "Must NOT read as 'available', 'balance' or 'remaining budget'. It is the bounded intersection of available cash and what the plan allows — the one figure that answers 'can I buy this?'",
  availableNow: "Raw liquid cash BEFORE any money is held back. Must read differently from safeToSpend.",
  reserved:
    "Must NOT read as 'spent'. The money has NOT left the account; it is held back for bills, debt and savings.",
  forecast: "A projection to the end of the period, not a current figure. Must not read as availableNow.",
  fundingCapacity: "What this period has to work with. Must NOT read as 'income'. Spending never reduces it.",
  unallocated:
    "A deliberate buffer that is NOT freely spendable. Must NOT read as safeToSpend or as 'left over'.",
  savingsFunded: "Only CONFIRMED money may be described as 'set aside'.",
  savingsReservedNotConfirmed:
    "Reserved but NOT yet confirmed. Must read clearly DIFFERENT from savingsFunded — this distinction is the entire point of the four contribution states.",
  pending: "An obligation not yet paid. Must NOT read as 'spent'.",
  overdueSince: "Still owed and still reserved. Must NOT read as 'cancelled' or 'written off'.",
  stateFull: "Exactly 100% used. Neither 'nearing' nor 'exceeded'.",
  bindingPlan: "Explains that THE PLAN was the tighter of two limits. Must read differently from bindingCash.",
  bindingCash: "Explains that AVAILABLE CASH was the tighter of two limits. Must read differently from bindingPlan.",
  bindingCashOnly: "There is no plan ceiling yet, so only cash limits spending.",
  includesRefund:
    "A PROVISIONAL guess the user can correct — not a confirmed fact. The wording must convey uncertainty.",
  rejectRefund: "The user declaring it is not a refund. Must NOT read as 'delete' or 'remove the transaction'.",

  // ── the four figures on a category card ──
  plannedShort: "Intent. Must read differently from spentShort, pendingShort and remaining.",
  spentShort: "Money already gone. Must read differently from plannedShort and pendingShort.",
  pendingShort: "Owed but still in the account. Must NOT read as spentShort.",
  remaining: "What is left of the intent. Must read differently from overBy.",
  overBy: "The signed counterpart of remaining — the amount by which a target was exceeded.",

  // ── obligations ──
  unpaidAmount:
    "CRITICAL: must NOT be translated as 'over' or 'exceeded'. An unpaid bill is RESERVED, not overspent — a bills envelope has no target to exceed.",
  paidShort: "A bill was settled. Distinct from ordinary spending (spentShort).",
  overdueShort: "Late but still owed and still reserved. Factual, never accusatory.",
  daysOverdue: "Neutral statement of lateness. Has _one/_other plural forms; keep {{count}}.",
  needsAttentionShort:
    "Several payments in a row are unpaid, so the RULE is probably wrong (a cancelled subscription). An invitation to look, not a reprimand.",

  // ── categories ──
  leftoverTag:
    "Tags the catch-all envelope, which claims EVERYTHING not claimed by a named category. Not 'other' or 'miscellaneous'.",
  uncategorisedNote:
    "The money IS tracked — by the leftover envelope. This says only that it matched no NAMED category. Must not read as 'untracked' or 'ignored'.",
  categoryTaken: "This category already belongs to a different envelope. Each category belongs to exactly one.",
  envelopeCategoriesHint: "Explains the one-category-one-envelope rule. The rule must survive the translation.",

  // ── overspend resolution ──
  overspendTitle: "States a fact about a target being exceeded. Neutral.",
  overspendBody:
    "States three numbers and offers help. Must contain NO reproach — no 'unfortunately', no 'you should have'.",
  moveFrom:
    "CRITICAL: must NOT borrow the app's account-transfer verb. NO money moves between accounts — only the plan's intent is redistributed.",
  coverFromUnallocated: "Uses the period's uncommitted buffer. NOT savings, NOT a fund.",
  raiseTarget: "The plan decides to allow more. Nothing is added; no money appears.",
  acceptOverspend:
    "CRITICAL: accepting a known overspend is a VALID choice. Must NOT read as the wrong answer, nor as 'ignore' or 'dismiss'.",
  overspendInline: "A calm pointer that options exist.",

  // ── settlements ──
  partiallySettled: "Money coming BACK, partly. Must read differently from fullySettled and from 'paid'.",
  fullySettled: "Money coming BACK, in full.",
  confirmedSettlement:
    "A STATED FACT, as opposed to includesRefund which is a guess. The two must read differently.",

  // ── bills ──
  billOneTime: "A single due date, tracked only by the budget.",
  billRecurring:
    "LINKS an existing recurring expense, which keeps control of the amount and the schedule. Must read differently from billOneTime.",
  billRecurringNote:
    "Explains that the recurring expense stays in charge and is marked paid automatically. That meaning must survive.",

  // ── history ──
  wasNamed: "The name AS AT the close of a past period. History is not rewritten by a later rename.",
  restated:
    "The audited, LEGITIMATE way a closed period is revised. Must NOT read as 'wrong', 'error' or 'corrected mistake'.",
}

const en = JSON.parse(fs.readFileSync("src/lib/i18n/locales/en.json", "utf8")).budgetV2

const args = process.argv.slice(2).filter((a) => LOCALES[a])
const targets = args.length ? args : Object.keys(LOCALES)

const outDir = "docs/budget-v2/i18n-review"
fs.mkdirSync(outDir, { recursive: true })

for (const lang of targets) {
  const loc = JSON.parse(fs.readFileSync(`src/lib/i18n/locales/${lang}.json`, "utf8")).budgetV2
  const rows = []
  for (const [key, constraint] of Object.entries(TERMS)) {
    if (en[key] === undefined) continue // key retired; skip rather than invent
    rows.push({ key, en: en[key], current: loc[key] ?? "(MISSING)", constraint })
  }

  const body = `# Budget v2 — ${LOCALES[lang]} translation review

Paste everything below into ChatGPT (or hand it to a native speaker).

---

You are reviewing the ${LOCALES[lang]} strings for the budgeting screen of
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

If two of these read the same way in ${LOCALES[lang]}, the feature stops working
for ${LOCALES[lang]} users, even though every individual word is defensible.

## Tone

The copy is deliberately **factual and non-judgemental**. It states what
happened and offers options. It never scolds the user for overspending, never
implies fault, and never uses alarming language. Please preserve that.
${lang === "ar" ? "\n## Direction\n\nArabic is right-to-left. Copy was written to avoid embedded left-to-right\nfragments, but please check that amounts, dates and numbers read naturally in\ncontext.\n" : ""}
## Mechanics you must not break

1. Every \`{{placeholder}}\` must appear in your output **exactly** as in the
   English, spelled identically. A missing or renamed placeholder fails our
   automated check and blocks the release.
2. Do not add or remove keys.
3. Keys ending \`_one\` / \`_other\` are plural variants. If ${LOCALES[lang]} needs
   different plural handling, say so in prose — do not invent new key suffixes.

## The terms

For each row: the key, the English source, the current ${LOCALES[lang]} string,
and **what it must not be confused with**.

${rows
  .map(
    (r) => `### \`${r.key}\`
- **English:** ${r.en}
- **Current ${lang}:** ${r.current}
- **Must not be confused with:** ${r.constraint}`,
  )
  .join("\n\n")}

## What to give back

1. A short prose note on anything that is **wrong, unnatural, or ambiguous** —
   especially any two terms that currently read too much alike.
2. Then a JSON object containing **only the keys you changed**, in exactly this
   shape (this is fed straight into our merge tool, so no extra nesting, no
   comments, no trailing commas):

\`\`\`json
{
  "${lang}": {
    "budgetV2.<key>": "<corrected ${lang} string>"
  }
}
\`\`\`

If a string is already right, **leave it out**. A short, targeted diff is far
more useful than a full retranslation.

---

## How the corrections get applied (for the developer)

\`\`\`bash
# save the JSON block as corrections.json, then:
#   --overwrite is REQUIRED for a review. Without it the merge only fills keys
#   that are MISSING, so a correction to an existing key is silently dropped.
node scripts/i18n-merge.mjs corrections.json --overwrite
npm run i18n:check
\`\`\`
`

  const file = path.join(outDir, `${lang}.md`)
  fs.writeFileSync(file, body, "utf8")
  console.log(`  ${file}  (${rows.length} terms)`)
}

console.log(`\n${targets.length} prompt(s) written to ${outDir}/`)
