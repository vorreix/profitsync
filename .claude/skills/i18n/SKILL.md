---
name: i18n
description: Use when adding, changing or reviewing ANY user-visible string — a new label, button, toast, error, placeholder, aria-label or empty state — or when touching src/lib/i18n/, a locale file, or a symptom like "this page is still in English in Malayalam", a missing translation, a broken {{placeholder}}, or a red i18n check in CI or the pre-commit hook. Establishes the rule that makes the gate real: a key that EXISTS is not a key that is TRANSLATED.
---

# Translations

**One sentence decides everything here: a key that exists is not a key that is translated.**

The parity gate used to check only that every key in `en.json` was *present* in the other
seven files. Pasting English into all of them satisfied that perfectly. So it was satisfied —
about 470 keys sat in English in every language, and `/debts` rendered half in English for
anyone reading Malayalam, while CI stayed green for months.

Two gates now, and both are in the pre-commit hook and in `.github/workflows/i18n.yml`:

| Gate | Script | Catches |
|---|---|---|
| Parity | `npm run i18n:check` | a key missing, blank, with a dropped `{{placeholder}}`, **or still the English text** |
| Hardcoded | `npm run i18n:hardcoded` | new user-visible English typed straight into JSX, which never reaches a locale file at all |

`npm run i18n:all` runs both. A `PostToolUse` hook (`.claude/hooks/i18n-guard.mjs`,
mirrored at `.codex/hooks/i18n-guard.mjs`) runs the relevant one the moment you edit a
locale file or a component, so a failure arrives while you still remember the string.

## The eight languages

`en` `it` `de` `hi` `ml` `ta` `te` `ar` — English is the source of truth for which keys
exist. Arabic is RTL; the i18n setup syncs `<html dir>`, so never add directional control
characters to a string yourself.

## Adding a string

1. **Add the key to `en.json` first.** Nest it under the page or feature that owns it
   (`debts.*`, `wealth.*`, `recurring.*`). Sentence case. No trailing full stop on labels.
2. **Translate it into all seven others.** Write real translations. Do not paste English in
   to make the check pass — that is the exact failure this gate exists for, and it now fails.
3. **Render it with `t()`.** A raw string in JSX is invisible to every gate except the
   hardcoded one, and invisible to every non-English user forever.

For more than a handful of keys, write a `{ lang: { "dotted.key": value } }` map and merge it:

```bash
node scripts/i18n-merge.mjs /tmp/new-keys.json          # additive: only fills what is MISSING
node scripts/i18n-merge.mjs /tmp/fixes.json --overwrite # replaces existing values
```

Picking the wrong mode fails silently: without `--overwrite` a correction to an existing key
reports success and changes nothing.

## Rules the gates enforce

- **Every `{{placeholder}}` survives**, same spelling, same count. A dropped one is a blank
  or a crash at runtime. Translate the words around it, never the placeholder name.
- **Plural keys** end `_one` / `_other` / `_zero` / `_two` / `_few` / `_many`. Use the target
  language's real plural grammar — Arabic has six forms, and `ar.json` legitimately carries
  keys `en.json` does not. `_zero` / `_one` / `_two` MAY omit `{{count}}`, because many
  languages spell the number out ("one client", "عميل واحد"); the others may not.
- **No new hardcoded English.** The ratchet in `src/lib/i18n/hardcoded-baseline.json` records
  the existing backlog per file (mostly `/admin`). A file may not go ABOVE its number, and a
  file not in the list may not appear. Fix some, lower the number, and it can never come back.
  Never raise a number to get a commit through — that is the check working.

## When English really is the right answer

Some strings are identical in another language: a brand (`Dodo Payments`), an international
standard (`IBAN`, `SWIFT / BIC`, `PDF`), sample data (`john@example.com`, `0.00`), a string
with no words in it (`{{count}} × {{amount}}`), or a genuine loanword — `Status`, `Budget`,
`Name` and `Tags` are ordinary German; `Account`, `Email` and `Analytics` are ordinary Italian.

List those in **`src/lib/i18n/identical-ok.json`**, per locale, with a one-line reason a
reviewer can read:

```json
"wealth.fieldIban": { "locales": ["*"], "why": "IBAN is the ISO 13616 standard, untranslated worldwide" },
"filters.status":   { "locales": ["de"], "why": "the same word in these languages" }
```

`["*"]` means every language. A word that is a loanword in German but not in Tamil belongs on
the German list alone. **"I could not think of a translation" is not a reason** — ask a
speaker, or keep the key out of the release.

## Voice

These are dense finance screens: buttons, table headers, chips. A translation twice as long
as the English breaks the layout, so prefer the short natural word to the literal one. Match
the register the locale file already uses — informal *tu* in Italian, *du* in German — and
reuse its existing terminology rather than inventing a second word for "budget".

Widely used English loanwords are correct in Hindi, Malayalam, Tamil and Telugu (बैंक, കാർഡ്,
பட்ஜெட்). Rare literary coinages are not: nobody says them, and they read as a machine
translation.

## This app's words

Mistranslating these changes what the screen means:

- **Space** — a named savings pot inside an account. Not a room, not an empty gap.
- **Recurring** — a scheduled template that creates transactions on its own.
- **Debt / Loan** — money owed BY the user. **Receivable** — money owed TO them.
- **Transfer** — money between the user's OWN accounts. Never income, never expense.
- **Refund** — money back for an earlier expense. Reduces spending, never income.
- **Statement** — one closed credit-card billing cycle.
- **Budget** — a spending limit in a rhythm. **Overall budget** — the single top-level one.
- **Workspace / Organization** — the tenant being worked in.
- **Quotation** — a price quote to a client, which can become a client.

## Verifying

```bash
npm run i18n:all                              # both gates, the same ones CI runs
node scripts/check-i18n-hardcoded.mjs --write # re-baseline AFTER fixing some (read the diff)
```

Then look at a page in a non-Latin script — `?lng=ml` or the language switcher — and read it.
A gate can prove a string was translated; only your eyes prove it is the right length for the
button it sits in.
