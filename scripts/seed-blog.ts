import { config } from "dotenv"
config({ path: ".env.local" })

import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import { eq } from "drizzle-orm"
import { blogPosts } from "../src/lib/db/schema"
import { readingTimeMinutes } from "../src/lib/blog"

// Seeds (and idempotently re-seeds) a set of high-quality, SEO/GEO-optimized pillar
// blog posts for ProfitSync. Each post follows docs/seo/PLAN.md's content playbook:
// answer-first intro, key-takeaways, descriptive H2/H3 hierarchy, a comparison
// table, an FAQ section (auto-emitted as FAQPage JSON-LD by the SSR), internal
// links, and a credible author byline (E-E-A-T). Re-running updates content by slug
// while preserving each post's original publish date.
//
// Run:  npx tsx scripts/seed-blog.ts        (uses DATABASE_URL from .env.local)
//
// Honesty note: these articles deliberately avoid invented statistics / fake
// citations — verified research flags fabricated numbers as a ranking + trust risk.

const AUTHOR_NAME = "ProfitSync Team"
const AUTHOR_JOB_TITLE = "Finance editors at ProfitSync"
const AUTHOR_BIO =
  "The ProfitSync team writes practical guides on the money side of independent work — profit, cash flow, expenses, quotations and multi-currency bookkeeping — drawn from building finance tooling for freelancers, agencies and small teams."

type SeedPost = {
  slug: string
  title: string
  excerpt: string
  articleSection: string
  tags: string[]
  seoTitle: string
  seoDescription: string
  content: string
}

const POSTS: SeedPost[] = [
  {
    slug: "expense-management-for-freelancers",
    title: "Expense Management for Freelancers: The Complete 2026 Guide",
    excerpt:
      "A practical, step-by-step guide to tracking business expenses as a freelancer — what counts, how to categorize, and how to never miss a deduction again.",
    articleSection: "Expenses & Tax",
    tags: ["expense management", "freelancing", "tax deductions", "bookkeeping"],
    seoTitle: "Expense Management for Freelancers: The Complete 2026 Guide",
    seoDescription:
      "Learn how to manage freelance business expenses in 2026: what's deductible, how to categorize spending, and a simple system to capture every receipt and lower your tax bill.",
    content: `Expense management is the practice of recording, categorizing and reviewing every cost your business incurs, so you always know what you spent, why, and how much of it is tax-deductible. For freelancers, good expense management is the difference between guessing at your profit and knowing it — and between paying tax on your revenue and paying it only on what you actually earned.

This guide walks through a simple system you can set up in an afternoon and run in minutes a week.

## Key takeaways

- **Expense management = capture, categorize, review.** Capture every receipt, tag it to a category, and review the totals before you invoice or file taxes.
- **Untracked expenses are paid-for tax deductions you throw away.** Money you can't prove you spent is money you can't deduct.
- **Categories are the whole game.** Consistent categories turn a pile of receipts into answers about where your money goes.
- **Do it continuously, not annually.** A few minutes each week beats a panicked weekend before your tax deadline.

## Why expense tracking matters more for freelancers

When you are employed, your employer absorbs the cost of running the business. When you freelance, *you* are the business — your laptop, software subscriptions, home-office costs, travel and professional services all come out of your revenue. Two things follow from that:

1. Every legitimate business expense reduces your taxable profit, so tracking them directly lowers your tax bill.
2. Your real income is revenue **minus** these costs. If you don't track expenses, you don't actually know what you earn.

The freelancers who feel "busy but broke" are almost always the ones who never subtract their true costs from their invoices.

## What counts as a business expense?

The general rule in most tax systems: an expense is deductible if it is **ordinary and necessary** for your work — a cost that is normal in your field and genuinely helps you do the job. Common freelance categories include:

| Category | Typical examples |
| --- | --- |
| Software & subscriptions | Design tools, accounting apps, cloud storage, domains |
| Hardware & equipment | Laptop, monitor, camera, phone (business-use share) |
| Home office | A portion of rent, utilities and internet |
| Professional services | Accountant, lawyer, contractors you hire |
| Marketing | Website, ads, portfolio hosting |
| Education | Courses, books and conferences in your field |
| Travel & meals | Client travel and eligible business meals |
| Bank & payment fees | Processor fees, currency conversion, account fees |

Rules differ by country, and mixed personal/business items (like a phone) are usually deductible only for the business-use portion. When in doubt, ask a local accountant — but track everything first, because you can't deduct what you never recorded.

> The single most expensive habit in freelancing is the receipt you meant to keep and didn't. A deduction you can't substantiate is one you can't claim.

## A simple expense system that actually sticks

The best system is the one you'll keep up with. Here's a four-step loop that takes minutes:

### 1. Capture at the moment of spend

Log the expense when it happens, not "later." Snap a photo of the receipt or forward the email confirmation immediately. In [ProfitSync](/), you can attach the receipt directly to the transaction so the proof lives next to the record.

### 2. Categorize consistently

Pick a small, fixed set of categories (the table above is a good start) and use them every time. Consistency is what lets you answer "how much did I spend on software this year?" in one glance.

### 3. Separate business from personal

Open a dedicated account or card for business spending. A clean separation removes the biggest source of bookkeeping pain and makes your records far easier to defend.

### 4. Review on a schedule

Once a week or month, scan your expense totals by category. You'll catch duplicate subscriptions, creeping costs, and anything miscategorized while it's still fresh.

## Turning expenses into decisions

Tracking isn't an end in itself — it's how you make better calls. Reviewing categorized expenses tells you which subscriptions you've stopped using, which clients cost more to serve than they pay, and whether a price rise is overdue. Pair this with [profit tracking](/blog/how-to-track-profit-small-business) and you move from "I think I'm doing okay" to "I know my margin on every project."

If you work with clients abroad, also read our guide to [multi-currency accounting](/blog/multi-currency-accounting-for-freelancers) — currency conversion fees are an expense category most freelancers forget entirely.

## Frequently asked questions

### What's the difference between expense tracking and expense management?

Expense tracking is the recording step — logging what you spent. Expense management is the full loop: capturing, categorizing, reviewing and acting on those expenses to control costs and maximize deductions.

### How often should I update my expenses?

Ideally at the moment of spend, or in a short weekly review. Continuous tracking prevents lost receipts and removes the year-end scramble before a tax deadline.

### Do I need separate business and personal accounts as a freelancer?

It isn't always legally required, but it's strongly recommended. A dedicated business account makes your records cleaner, your deductions easier to prove, and your bookkeeping dramatically faster.

### Can I deduct home-office and phone costs?

Usually you can deduct the business-use portion, but the exact rules vary by country and situation. Track the full cost and the business-use share, then confirm the eligible amount with a local accountant.

### What's the easiest way to never lose a receipt again?

Attach the receipt to the transaction the moment you record it. Keeping the proof and the record together — as you can in ProfitSync — means nothing goes missing before tax time.

---

Ready to stop guessing? [Create a free ProfitSync workspace](/signup) and log your first expense in under a minute.`,
  },
  {
    slug: "how-to-track-profit-small-business",
    title: "How to Track Profit in Your Small Business (Without a Spreadsheet)",
    excerpt:
      "Profit is revenue minus costs — but most small businesses never see it clearly. Here's a simple way to track real profit in real time.",
    articleSection: "Profit Tracking",
    tags: ["profit tracking", "small business", "bookkeeping", "dashboard"],
    seoTitle: "How to Track Profit in Your Small Business (2026 Guide)",
    seoDescription:
      "A clear, practical guide to tracking profit in a small business: what profit really is, the numbers to watch, and how to see your real-time margin without spreadsheets.",
    content: `To track profit, record all the money coming in and all the money going out, assign each to a category, and watch the difference over time. That difference — revenue minus costs — is your profit, and it's the only number that tells you whether your business actually works.

Most small businesses track revenue obsessively and profit almost never. This guide fixes that.

## Key takeaways

- **Profit = money in − money out.** Revenue is vanity; profit is reality.
- **You need both sides logged.** Tracking sales without tracking costs tells you nothing about profit.
- **Real time beats year-end.** A live view lets you correct course while it still matters.
- **A dashboard turns data into decisions** — far better than a spreadsheet you update once a quarter.

## Revenue is not profit

It's easy to feel successful when invoices are going out. But revenue is the top line — the total you bill. Profit is what's left after every cost: software, contractors, fees, taxes set aside, and your own time. A business can have rising revenue and shrinking profit at the same time, and the owner won't know until the money runs short.

> If you only watch revenue, you're driving while looking at your speedometer and ignoring the fuel gauge.

## The three numbers to watch

You don't need an accounting degree. Watch three things:

1. **Income** — everything you're paid, per client and in total.
2. **Expenses** — everything you spend, by category (see our [expense management guide](/blog/expense-management-for-freelancers)).
3. **Net profit** — income minus expenses, over a chosen period.

If you want to go one level deeper, split profit into *gross* (revenue minus the direct costs of delivering the work) and *net* (after all overheads). For most solo businesses, net profit per month is the headline number.

## Profit vs cash flow — don't confuse them

Profit and cash flow are different, and mixing them up is a classic mistake. Profit is whether your work earns more than it costs. Cash flow is whether the money is actually in your account *when you need it*. You can be profitable and still run out of cash if clients pay late. We cover this in depth in [Profit vs Cash Flow](/blog/profit-vs-cash-flow) — read it next.

## How to track profit step by step

### 1. Capture every transaction

Log income when you're paid and expenses when you spend. The goal is a complete record — gaps make every downstream number wrong.

### 2. Categorize both sides

Tag income by client and expenses by type. Categories are what let you ask "which client is most profitable?" or "what's eating my margin?"

### 3. Pick a period and review it

Profit only means something over a span of time. Look at it monthly to spot trends; look at it per project to price better.

### 4. Watch it on a dashboard

A spreadsheet shows numbers; a dashboard shows *answers*. A live profit dashboard updates the moment you log a transaction, so you always know where you stand without rebuilding formulas.

| Method | Effort to maintain | How current it is | Risk |
| --- | --- | --- | --- |
| Spreadsheet | High (manual entry + formulas) | As old as your last update | Broken formulas, version sprawl |
| Bank balance "feel" | None | Misleading | Confuses cash with profit |
| Live profit dashboard | Low (log as you go) | Real time | Minimal |

## Make profit a habit, not an event

The businesses that grow steadily treat profit as a number they check often — the way you check the weather — not a mystery they uncover once a year. Logging takes seconds when you do it as you go. The payoff is decisions made on facts: which clients to keep, what to charge, and when you can actually afford to invest.

[ProfitSync](/) was built for exactly this: log income and expenses in seconds, and watch net profit update live on a dashboard — no spreadsheet required.

## Frequently asked questions

### What's the difference between profit and revenue?

Revenue is the total amount you bill or are paid. Profit is what remains after subtracting all your costs. Revenue can rise while profit falls, which is why profit is the number that matters.

### How is profit different from cash flow?

Profit measures whether your work earns more than it costs over a period. Cash flow measures whether money is in your account when you need it. A profitable business can still have a cash-flow problem if customers pay late.

### Do I need accounting software to track profit?

No, but it helps enormously. You can start in a spreadsheet, but a tool that logs income and expenses and shows net profit live removes the manual upkeep and the errors that come with it.

### How often should I check my profit?

Monthly is a good rhythm for spotting trends, plus a per-project view to help you price work. With a live dashboard you can glance at it any time without extra effort.

### What is a good profit margin for a small business?

It varies widely by industry, so compare against your own history first. The most useful habit is watching your margin trend over time and protecting it as you grow.

---

[Start tracking your real profit free](/signup) — create a ProfitSync workspace and see your margin update live.`,
  },
  {
    slug: "cash-flow-management-for-freelancers",
    title: "Cash Flow Management for Freelancers: A Practical Guide",
    excerpt:
      "Profitable freelancers still go broke when cash arrives late. Here's how to manage cash flow so there's always money when you need it.",
    articleSection: "Cash Flow",
    tags: ["cash flow", "freelancing", "invoicing", "payment terms"],
    seoTitle: "Cash Flow Management for Freelancers: A Practical Guide (2026)",
    seoDescription:
      "Manage freelance cash flow with confidence: understand timing gaps, set smarter payment terms, build a buffer, and keep money in your account when you need it.",
    content: `Cash flow management is making sure money is in your account when you need it — that the timing of money coming in lines up with the timing of money going out. For freelancers, it's the skill that keeps a profitable business from stalling when a big client pays 45 days late.

You can be profitable on paper and still unable to pay rent. This guide is about preventing that.

## Key takeaways

- **Cash flow is about timing, not totals.** The question isn't "do I earn enough?" but "is the money here when bills are due?"
- **Late payment is the #1 freelance cash-flow killer.** Your terms and follow-up are your defense.
- **A cash buffer turns crises into inconveniences.** Aim to hold a few months of essential costs.
- **Profit and cash flow are different** — track both. See [Profit vs Cash Flow](/blog/profit-vs-cash-flow).

## The freelance cash-flow problem

Freelance income is lumpy. You finish a project, send an invoice, and then wait — often weeks — to be paid, while rent, subscriptions and taxes keep their steady schedule. The mismatch between *when you earn* and *when you're paid* is the core challenge. Manage the timing and the stress mostly disappears.

> Revenue tells you the project was worth doing. Cash flow tells you whether you can keep the lights on until it pays.

## Five levers you control

### 1. Invoice immediately and clearly

The clock on payment starts when the invoice lands, not when the work ends. Send it the day you finish, with clear terms and an easy way to pay. Turning an accepted [quotation into an invoice](/blog/how-to-write-a-quotation) the moment work is approved removes days of delay.

### 2. Set payment terms that protect you

"Net 30" is a habit, not a law. Consider shorter terms, deposits up front, milestone payments on larger jobs, and a stated late fee. Deposits in particular smooth cash flow because you're paid *before* you incur most costs.

### 3. Follow up on time, every time

Most late payments aren't refusals — they're forgetfulness. A polite reminder a day or two after the due date recovers far more cash than waiting and hoping.

### 4. Build and defend a buffer

A cash reserve covering a few months of essential costs is what lets you ride out a slow month or a late-paying client without panic. Treat it as a fixed business cost, funded a little from every payment.

### 5. Smooth out the spikes

Set aside tax with every payment so a tax bill never becomes a cash-flow shock. If your work is seasonal, save from the busy months to cover the quiet ones.

## A simple cash-flow routine

| Frequency | Do this |
| --- | --- |
| Per project | Take a deposit; invoice the moment work is approved |
| Weekly | Check what's owed to you and chase anything overdue |
| Per payment | Move a fixed share to tax and to your buffer |
| Monthly | Compare money in vs money out and look one month ahead |

The aim is a short, repeatable habit — not a forecast model. Knowing roughly what's coming in and going out over the next 30–60 days is enough to avoid almost every cash crunch.

## Cash flow and profit work together

Strong cash flow doesn't make an unprofitable business viable, and good profit doesn't help if you can't access the cash. Track both: [profit](/blog/how-to-track-profit-small-business) tells you the work is worth doing, cash flow tells you you'll survive until it pays. A workspace that shows incoming and outgoing money together — like [ProfitSync](/) — lets you watch both at once.

## Frequently asked questions

### What is cash flow management?

It's the practice of managing the timing of money in and out of your business so you always have funds available when you need them — by invoicing promptly, setting good payment terms, chasing late payments, and keeping a buffer.

### Can a profitable freelancer still have cash-flow problems?

Yes. Profit is earned over a period; cash flow is about timing. If clients pay slowly while your bills arrive on schedule, you can be profitable and still short of cash.

### How do I deal with clients who pay late?

Set clear terms up front, invoice immediately, send a friendly reminder right after the due date, and consider deposits and late fees. Most late payments are oversights that a timely nudge resolves.

### How big should my cash buffer be?

A common goal is enough to cover a few months of essential business and personal costs. Build it gradually by setting aside a fixed share of every payment.

### Should I take deposits from clients?

Deposits are one of the most effective cash-flow tools for freelancers because they put money in your account before you incur most of the project's costs.

---

[Track money in and money out for free](/signup) with ProfitSync and keep your cash flow under control.`,
  },
  {
    slug: "how-to-write-a-quotation",
    title: "How to Write a Quotation That Wins Clients (+ What to Include)",
    excerpt:
      "A clear, professional quotation wins more work and prevents scope disputes. Here's exactly what to include and how to turn a quote into a paying client.",
    articleSection: "Quotations",
    tags: ["quotations", "proposals", "freelancing", "invoicing"],
    seoTitle: "How to Write a Quotation That Wins Clients (2026 Guide + Checklist)",
    seoDescription:
      "Learn how to write a professional quotation: what to include, how to price and present it, the difference from an invoice, and how to convert an accepted quote into a client.",
    content: `A quotation is a formal document that tells a prospective client exactly what you'll deliver, for how much, and on what terms — before any work begins. A clear quotation wins more work, sets expectations, and prevents the scope arguments that sour client relationships.

Here's how to write one that gets a "yes."

## Key takeaways

- **A quotation is a promise of price and scope**, sent before work starts.
- **Specificity wins.** Vague quotes invite scope creep; detailed ones build trust.
- **A quotation is not an invoice.** A quote proposes; an invoice requests payment for work agreed or done.
- **Speed matters.** The faster you send a clear quote, the more likely you are to win the job.

## What to include in a quotation

A professional quotation has a predictable structure. Include every item below:

| Section | What it covers |
| --- | --- |
| Your details | Name/business, contact info, logo |
| Client details | Who the quote is for |
| Quote number & date | For reference and an expiry date |
| Scope of work | Exactly what's included — line by line |
| Pricing | Per-item costs and a clear total |
| Terms | Payment schedule, deposit, timeline |
| Validity | How long the price holds (e.g. 30 days) |
| Next step | How to accept |

### Scope is where deals are won or lost

The scope section is the heart of the quote. List deliverables specifically — "Homepage, 4 inner pages, mobile-responsive, two rounds of revisions" beats "a website." Naming what's included also quietly defines what *isn't*, which is your best protection against scope creep later.

> The quote that wins isn't always the cheapest — it's the one that makes the client feel certain about what they'll get.

## How to price and present it

- **Price the value, not just the hours.** Anchor on the outcome you deliver, not only the time it takes.
- **Offer tiers when it helps.** A good/better/best structure lets clients choose up rather than walk away.
- **Be transparent.** Break down the total so there are no surprises.
- **Look the part.** A clean, branded document signals you'll bring the same care to the work.

## Quotation vs invoice: what's the difference?

People mix these up constantly. The distinction is simple:

| | Quotation | Invoice |
| --- | --- | --- |
| Purpose | Proposes price & scope | Requests payment |
| When | Before work begins | After work is agreed or done |
| Status | Awaiting acceptance | Payment due |

The cleanest workflow connects the two: send a quotation, get it accepted, and convert it directly into the engagement — no re-typing details, no lost information.

## From accepted quote to paying client

A "yes" is only valuable if it turns into work and payment smoothly. The moment a quote is accepted:

1. Confirm the scope and start date in writing.
2. Take any agreed deposit (great for [cash flow](/blog/cash-flow-management-for-freelancers)).
3. Convert the accepted quotation into an active client and project.

In [ProfitSync](/), you can build a quotation, mark it sent or accepted, and convert a winning quote into a client in one click — so nothing is re-keyed and every future invoice and expense ties back to that relationship.

## Frequently asked questions

### What is a quotation in business?

A quotation is a document sent to a prospective client that sets out exactly what you'll provide, the price, and the terms — before the work starts. It's an offer the client can accept.

### What's the difference between a quotation and an invoice?

A quotation proposes a price and scope before work begins and awaits the client's acceptance. An invoice requests payment for work that's been agreed or completed. A quote comes first; an invoice follows.

### How long should a quotation be valid?

Include an expiry date — 14 to 30 days is common. A validity window protects you from honoring a price months later when your costs or availability have changed.

### How do I stop scope creep with quotations?

Be specific about deliverables and explicitly note what's included (and, where useful, what's not). A detailed scope is your reference point if a client later asks for more.

### Can I turn an accepted quotation into an invoice?

Yes — and you should, to avoid re-typing details. Tools like ProfitSync let you convert an accepted quotation into a client and project directly, keeping scope, pricing and contact details intact.

---

[Create professional quotations free](/signup) with ProfitSync — and convert the winners into clients in one click.`,
  },
  {
    slug: "multi-currency-accounting-for-freelancers",
    title: "Multi-Currency Accounting for Global Freelancers",
    excerpt:
      "Working with international clients means juggling currencies, conversion fees and exchange-rate swings. Here's how to keep your numbers clean.",
    articleSection: "Multi-Currency",
    tags: ["multi-currency", "international", "freelancing", "bookkeeping"],
    seoTitle: "Multi-Currency Accounting for Global Freelancers (2026 Guide)",
    seoDescription:
      "A practical guide to multi-currency accounting for freelancers with international clients: choosing a base currency, handling conversion fees, and keeping clean records.",
    content: `Multi-currency accounting is tracking income and expenses that occur in more than one currency while keeping a single, consistent view of your finances. For freelancers with international clients, it's what keeps exchange rates and conversion fees from quietly distorting your profit.

If you invoice abroad, this is for you.

## Key takeaways

- **Pick one base currency** and report everything in it for a consistent picture.
- **Conversion fees are a real, recurring expense** — track them, don't ignore them.
- **Exchange rates move**, so the value you record can differ from the value you receive.
- **A multi-currency-aware workspace** removes most of the manual math.

## Why multi-currency is tricky

When a client in another country pays you, several things happen at once: the amount is set in their currency, an exchange rate converts it, and your payment provider or bank usually takes a fee on the way. The amount you invoiced, the amount that hit your account, and the amount you can spend can all differ. Without a system, your records drift from reality.

> The invoice says one number, the bank deposits another, and the difference — fees plus rate movement — is profit you'll misjudge if you don't record it.

## Choose a base currency

Your base currency is the one you think, plan and report in — usually where you live and pay taxes. Every transaction, whatever currency it happened in, should also be viewable in your base currency so totals, charts and profit make sense. Set this once and stay consistent; switching base currencies mid-stream makes historical comparisons meaningless.

In [ProfitSync](/) you set a currency per workspace, and amounts, charts and totals are formatted the way that workspace reads its numbers — so a workspace for international work stays coherent.

## Handle conversion fees as an expense

Currency conversion and cross-border payment fees are a genuine cost of doing international business — and one most freelancers forget to track. Treat them like any other [business expense](/blog/expense-management-for-freelancers): give them their own category and record them each time. Over a year they add up, and seeing the total often justifies switching to a cheaper payment method.

## Practical tips for clean multi-currency records

1. **Record the rate you actually got.** Use the real converted amount that reached your account, not a textbook mid-market rate.
2. **Separate the fee from the income.** Log what the client paid and the conversion fee as distinct lines, so neither distorts the other.
3. **Be consistent about timing.** Decide whether you record income at invoice date or payment date — and stick to it.
4. **Keep the proof.** Attach the payment confirmation showing the rate and fee.
5. **Review in your base currency.** Judge profit on the consolidated, base-currency view, not a mix of currencies.

## How it connects to the rest of your finances

Multi-currency work touches everything: it affects your [cash flow](/blog/cash-flow-management-for-freelancers) (conversions and cross-border transfers can be slow), your [expenses](/blog/expense-management-for-freelancers) (fees), and your [profit](/blog/how-to-track-profit-small-business) (rate movement). The fix is the same in every case — record what actually happened, in a workspace that can show it all in one currency.

## Frequently asked questions

### What is multi-currency accounting?

It's the practice of recording income and expenses that occur in different currencies while maintaining one consistent view — usually by converting everything to a single base currency for reporting.

### What base currency should a freelancer use?

Generally the currency of the country where you live and pay taxes, since that's where you plan and report. Choose one and stay consistent so historical comparisons remain meaningful.

### How do I handle currency conversion fees?

Treat them as a business expense with their own category, and record them separately from the income they're attached to. Tracking them reveals the true cost of getting paid internationally.

### Should I record income at the invoice rate or the payment rate?

Either can work, but be consistent. Many freelancers record the actual amount received (the real payment-date rate) because that's the cash they can spend. Confirm the right approach for your tax rules locally.

### Does ProfitSync support multiple currencies?

Yes. ProfitSync lets you set a currency per workspace, so amounts, charts and totals are formatted for the way that part of your business reads its numbers.

---

[Run your numbers in any currency, free](/signup) — set up a ProfitSync workspace for your international work.`,
  },
  {
    slug: "profit-vs-cash-flow",
    title: "Profit vs Cash Flow: What's the Difference (and Why It Matters)",
    excerpt:
      "Profit and cash flow sound similar but measure different things. Confusing them is how profitable businesses run out of money.",
    articleSection: "Profit Tracking",
    tags: ["profit tracking", "cash flow", "small business", "finance basics"],
    seoTitle: "Profit vs Cash Flow: The Difference Every Business Owner Needs",
    seoDescription:
      "Profit vs cash flow explained simply: what each measures, why a profitable business can run out of cash, and how to track both so neither catches you out.",
    content: `Profit is what's left after you subtract all your costs from your revenue over a period of time. Cash flow is the movement of money in and out of your account, and whether there's enough there when you need it. They're related but different — and confusing them is one of the most common, and most dangerous, mistakes in small business.

## Key takeaways

- **Profit is earnings over a period.** Cash flow is money in your account right now.
- **A business can be profitable and still run out of cash** if income arrives later than bills are due.
- **A business can have cash but no profit** — for example, by spending a loan or a deposit it hasn't earned.
- **You need to watch both,** because each answers a question the other can't.

## Two different questions

Profit answers: *"Is my work worth more than it costs?"* Cash flow answers: *"Do I have the money to pay what's due today?"* A healthy business needs a "yes" to both — but they don't always agree at the same moment.

> Profit is a verdict on the period. Cash flow is the balance in your account this morning. Both can be true at once: profitable on paper, short on cash in the bank.

## A simple example

Imagine you finish a $5,000 project in January. You've earned it, so January looks profitable. But the client pays on Net 45 terms, so the cash doesn't arrive until March. Meanwhile, February's rent, software and taxes are all due. On paper you're profitable; in your account you're scrambling. That gap — between earning and receiving — is a cash-flow problem, not a profit problem, and you solve it with timing tools, not by working more.

| | Profit | Cash flow |
| --- | --- | --- |
| Measures | Earnings over a period | Money moving in/out, timing |
| Question | Is the work worth it? | Can I pay what's due now? |
| Hurt by | High costs, low prices | Late payments, lumpy income |
| Fixed by | Pricing, cost control | Deposits, terms, a buffer |

## Why the confusion is dangerous

Owners who watch only their bank balance mistake cash for profit — and overspend when a deposit or loan inflates the balance. Owners who watch only profit assume that because the work is profitable, the money will be there — and get blindsided when it isn't. Both blind spots are avoidable by tracking the two numbers side by side.

## How to track both

- For profit: log income and expenses, categorize them, and review net profit by period. See [How to track profit](/blog/how-to-track-profit-small-business).
- For cash flow: invoice fast, take deposits, watch what's owed to you, and keep a buffer. See [Cash flow management for freelancers](/blog/cash-flow-management-for-freelancers).

The simplest setup shows both in one place: every payment and expense logged, net profit on a dashboard, and a clear view of money in versus money out. That's exactly what [ProfitSync](/) is built to do.

## Frequently asked questions

### What is the main difference between profit and cash flow?

Profit is revenue minus costs over a period — a measure of whether your work earns more than it costs. Cash flow is the timing of money moving in and out of your account. Profit is a result; cash flow is about availability.

### Can a business be profitable but still fail?

Yes. If profitable work is paid for too late to cover bills that are due sooner, a business can run out of cash and fail despite being profitable on paper. This is one of the most common causes of small-business failure.

### Can a business have positive cash flow but no profit?

Yes. Spending a loan, an investment, or a customer deposit can fill your account with cash you haven't actually earned. The balance looks healthy while the business is unprofitable.

### Which should I focus on, profit or cash flow?

Both. Profit tells you the business model works; cash flow tells you it can survive day to day. Track them together so neither problem catches you by surprise.

### How can I track profit and cash flow together?

Use a single system that records all income and expenses, shows net profit over time, and makes money-in versus money-out visible. ProfitSync brings both into one dashboard.

---

[See your profit and cash flow in one place](/signup) — create a free ProfitSync workspace.`,
  },
]

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set (add it to .env.local).")
  }
  const sql = neon(process.env.DATABASE_URL)
  const db = drizzle(sql, { schema: { blogPosts } })

  const now = new Date()
  for (const post of POSTS) {
    const [existing] = await db.select().from(blogPosts).where(eq(blogPosts.slug, post.slug))
    const base = {
      title: post.title,
      excerpt: post.excerpt,
      content: post.content,
      coverImageUrl: "",
      tags: post.tags,
      authorName: AUTHOR_NAME,
      authorJobTitle: AUTHOR_JOB_TITLE,
      authorBio: AUTHOR_BIO,
      articleSection: post.articleSection,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      readingTimeMinutes: readingTimeMinutes(post.content),
      status: "published" as const,
      updatedAt: now,
    }

    if (existing) {
      await db.update(blogPosts).set(base).where(eq(blogPosts.id, existing.id))
      console.log(`updated  /blog/${post.slug}`)
    } else {
      await db.insert(blogPosts).values({ slug: post.slug, ...base, publishedAt: now })
      console.log(`inserted /blog/${post.slug}`)
    }
  }
  console.log(`\nSeeded ${POSTS.length} blog posts.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
