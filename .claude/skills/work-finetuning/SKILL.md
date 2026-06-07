---
name: work-finetuning
description: Use when given a LARGE multi-task product brief (many numbered fixes/features at once, often rough or non-native English) to execute autonomously end-to-end with no further intervention — deep parallel research, adversarial verification of findings, a structured stacked-branch plan + live tracking doc, mobile-first UX implementation with smooth transitions, instant in-place data updates (no full-screen reloads on add/edit/delete), perceived-speed/optimistic UI, browser (Playwright) verification, the full pre-commit gate, and a pushed branch per task. Trigger on "/work-finetuning", "finetune this", "here are N things to fix, do them all yourself", "implement this whole list and push each as a branch", "make the UI feel faster / stop reloading the whole screen", or any big batch of UX/UX polish + correctness work where the user says they won't be available to review mid-way.
---

# Work Fine-Tuning

Turn a big, messy, "do all of these and don't ask me" brief into a clean series of
**small, verified, pushed branches** — each one a single task, each one passing the
project's quality gate, each recorded in a living plan document the user can follow.

The user is **not** available to clarify or review while you work. That raises the
bar, it doesn't lower it: you must make sensible decisions, **verify your own
work**, and be honest in the tracking doc about what is proven vs. deferred. The
product north star is almost always the same — **simple, lovable, mobile-first
UX** with correct data — so optimise for that when a choice isn't specified.

This skill is rigid about the *process* (research → verify → plan → implement →
verify → gate → push → document) and flexible about the *implementation*.

## When this applies

- A numbered list of 5–20+ fixes/features to implement in one go.
- "Create a branch for each, chained from the previous, push each, track progress."
- Emphasis on UX simplicity, mobile-friendliness, transitions, perceived speed.
- Explicit "I won't intervene / do everything yourself."

If it's a single focused change, this is overkill — just do that change.

## The operating procedure

Create a TodoWrite (or equivalent) with these phases, then work them in order.

### 1. Capture & structure the brief — before touching code

- Re-read every item **literally**, then re-interpret. The brief is often
  imprecise/non-native English; the *symptom* described may not be the *bug*.
  (E.g. "deleting shouldn't add/subtract from the balance" actually meant
  "bulk-delete of a split corrupts the balance — fix the partial reversal", not
  "stop reversing on delete".)
- Flag blank/incomplete items and **park** them (don't invent scope) — note it in
  the plan, keep moving.
- Group tightly-coupled items into one branch (e.g. "collapsible card + attachments
  + edit button on the same page"). Split cross-cutting concerns into their own.

### 2. Deep parallel research — one agent per task cluster

Launch a **Workflow** with one research agent per task (read-only). Each returns a
structured finding: relevant files, *current behaviour with file:line*, the precise
root cause/gap, a grounded approach, files to modify, risks, and whether a
migration / i18n keys are needed. Give every agent the stack summary + "trace real
execution paths, cite file:line, do NOT edit". See `references/playbook.md` for the
exact schema and prompt shape.

In parallel, **read the cross-cutting infrastructure yourself** (the cache/data
layer, the modal primitives, the auth/scoping, the money/ledger logic, the build/
PWA config). You need first-hand ground truth to judge the agents.

### 3. Adversarially verify the findings — trust nothing on the money path

Research agents **hallucinate plausible bugs**, especially around signs, money, and
caching. Before acting on any finding that changes behaviour:

- Re-derive it by hand from the actual code. (A pass once claimed an
  outgoing-delete balance reversal was "sign-inverted" — it was correct;
  "fixing" it would have corrupted every delete.)
- For anything touching money/ledgers/idempotency, write a **pure unit test** that
  locks the correct behaviour *before* you change code around it.
- Record each correction explicitly in the plan ("⚠️ Correction: agent said X, it's
  actually Y") so the reasoning is auditable.

Common debunked patterns to watch for: see `references/conventions.md` →
"Corrections we've had to make".

### 4. Write the stacked-branch plan + live tracking doc

Create `docs/finetuning/PLAN.md` (or similar). It is the **single source of truth**
and the deliverable the user follows. It must contain:

- Working conventions (mobile-first, transitions, i18n, scoping, money rules,
  perceived speed, validation, the gate).
- A **Branch Chain table** (the live tracker): one row per branch/task, ordered by
  dependency + risk. Front-load the **verifiable, low-risk** wins; do the heavy
  cross-cutting refactors later so they build on stabilised code.
- A per-task section: Problem → Verified root cause → Approach → Files → Risks →
  Verify → Status. Update Status + a change-log entry as each branch lands.

Commit the plan on the **root branch of the chain** (e.g. `feat/<name>-00-plan`)
off the user's current branch, so it flows into every subsequent branch.

### 5. Implement — one branch per task, chained

For each task, in order:

1. `git checkout -b <next-branch>` **from the previous branch** (stacked chain).
2. Implement following the verified approach. Match surrounding code style.
   - **Mobile-first**: design for ~390px first; ≥44px touch targets; reuse the
     project's responsive primitives. Verify both a phone and a desktop width.
   - **Transitions**: for any new motion (collapse, modal, list, reorder, optimistic
     insert) use the `/transition-creator` skill; animate transform/opacity (or the
     grid `0fr→1fr` trick), respect `prefers-reduced-motion`.
   - **i18n**: every user-visible string via the i18n hook; add to the source
     locale, then propagate to **all** other locales (use the project's merge
     script); the parity check gates the commit.
   - **Migrations**: after a schema change, generate the migration and **watch the
     journal-timestamp gotcha** — the new entry's `when` must exceed the previous,
     or it silently skips. Apply it and confirm the column exists.
   - **Instant data updates (no full-screen reload).** After *any* create / edit /
     delete, update the affected list **in place** — never call a fetch that swaps
     the list for a loading skeleton. Create → insert the returned row; edit →
     replace it; delete → remove it **optimistically** and adjust totals/summaries,
     reconciling via a **silent** refetch (no skeleton) only on failure. Modals
     close instantly and save in the background, reopening with the data + a toast
     on failure. This is the single biggest "feels fast" lever — see
     `references/playbook.md` → "Smooth data mutations". The brief almost always
     wants this even if it's only stated once; apply it to **every** list page.
   - **Persisted UI preferences.** A user's collapse/expand (and similar) choices
     should survive navigation AND restart — back them with `localStorage`, keyed
     per entity (`usePersistedOpen(key, fallback)`), not component‑local `defaultOpen`.
3. **Verify in a real browser (Playwright/Chrome DevTools)** wherever reachable:
   screenshot the change, confirm 0 *new* console errors, exercise the actual flow
   (e.g. add → edit → confirm the balance re-synced). Clean up any test data you
   create. If a page is gated (onboarding/role) and you can't reach it, say so in
   the doc and rely on typecheck + careful review.
4. Run the **full gate** (the project's pre-commit: i18n → lint → typecheck →
   tests). It must pass (warnings are OK if the repo tolerates them).
5. Commit (with the project's co-author trailer), update `PLAN.md` status, push the
   branch. Open a PR if `gh` is authenticated; otherwise note the branch URL.

### 6. Finish

- Update the plan's change-log and the persistent memory note.
- Author/refresh this skill if you learned something reusable.
- Summarise: branches shipped, what each delivers, what was verified vs. deferred,
  and any follow-ups — honestly.

## Non-negotiables (the discipline that makes the output trustworthy)

- **Verify money/correctness paths with tests + by hand.** Never ship a balance/
  ledger change you only "reasoned about".
- **Every branch passes the gate before push.** No `--no-verify`.
- **Be honest in the doc.** "Verified with Playwright" vs "typecheck-only, visual
  deferred" are different claims — keep them distinct.
- **Don't over-reach risky refactors blind.** When the safe-but-complete version is
  a primitive + a verified reference + a documented rollout, ship that rather than a
  fragile app-wide rewrite (esp. in financial code). State the trade-off.
- **Never reload the whole screen for one item.** Add/edit/delete updates the
  single affected row in place (optimistically); a full‑list refetch that flashes
  a skeleton is a bug, not a refresh. If a "make it feel faster" complaint comes
  back, it's almost always because a mutation still calls the blunt refetch —
  finish the rollout to *every* page, don't leave it as "primitive + one reference".
- **Clean up test data** you create in shared dev databases.
- **Mobile-first and lovable** is the default tie-breaker for any unspecified choice.

## References

- `references/playbook.md` — the research-workflow schema/prompt, the gate
  commands, the migration + i18n mechanics, the git stacked-branch recipe, the
  Playwright verification loop, and **"Smooth data mutations"** (the full
  surgical/optimistic add‑edit‑delete + perceived‑speed mechanism) and
  **"Persisted UI state"**.
- `references/conventions.md` — ProfitSync-specific architecture facts and the
  list of corrections/gotchas learned (money sign, PWA precache, RHF risk, plan
  account-type gating, trash double-reversal, journal timestamps, the silent‑refetch
  data layer, split‑edit‑recreate vs attachments, logo fill, `usePersistedOpen`).
