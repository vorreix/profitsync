# Handoff — per-account colours on Wealth & Spaces

**Date:** 2026-09-10 · **Branch:** `feat/wealth-account-colors` → PR into `dev` · **Migration:** `0075`

Read this before touching anything under *Files that matter*. It exists so the next
agent does not have to re-derive why the colour lives where it does.

---

## What the feature is

Credit cards have worn bank-branded plastic since the Cards release. The bank, Cash
and Space tiles next to them were all the same grey card surface, so telling two
accounts apart meant reading the name. Every wealth account now has a colour.

Two columns on `wealth_accounts`, **presentation only** — no money maths reads them,
ever:

| Column | Meaning |
|---|---|
| `color` | `''` = **AUTO**, otherwise `#RRGGBB` (the user's override). CHECK-constrained. |
| `color_style` | `subtle` (default) or `bold`. CHECK-constrained. |

## The one rule that keeps it honest

**There is exactly one resolver: `src/lib/account-color.ts`.** Never read
`account.color` in a component — call `accountAppearance(account)` and spread what it
gives you. It returns the hex, where the hex came from, whether the tile is bold, the
text family that reads on it, and the CSS variables to put on the element.

Resolution order (`resolveAccountColor`):

1. the user's `#RRGGBB`
2. the bank's curated brand colour, matched on `brand_domain` — **the same
   `CURATED_BANK_COLORS` table in `src/lib/cards.ts` that paints the card visuals**,
   which is what makes an HDFC bank tile and an HDFC card agree
3. a stable swatch from the row id (FNV-1a → `ACCOUNT_SWATCHES`)

Cash short-circuits to a fixed emerald and a Space to the savings teal, both before
step 3 and both overridable by step 1. A tile is therefore already coloured the
moment the feature ships — the picker only ever overrides a choice the app made, and
the **Auto** chip puts it back.

## Invariants — break these and the feature quietly rots

- **Presentation only.** Nothing in `account-color.ts` may ever be imported by a
  balance, budget, alert or statement path. A colour is identity, like a card's
  `last4`.
- **AUTO must be stable.** A colour that changes between loads is worse than no
  colour, which is why step 3 hashes the **row id** and not the name (a rename would
  repaint the tile).
- **Every swatch must take white text at AA.** That is what lets `bold` skip a second
  palette. `account-color.test.ts` fails the build if a swatch is added whose
  relative luminance is ≥ 0.42 — fix the swatch, never the test.
- **One validator for all four write paths.** `api/_lib/account-appearance.ts` is
  shared by `/api/wealth/accounts` (POST + PATCH) and `/api/spaces` (POST + PATCH),
  so a Space and a bank cannot disagree about what a valid colour is. A key that is
  **absent** from the body is left out of the patch entirely — that is what stops a
  rename or a balance adjustment from silently resetting a colour.
- **Both themes travel on the element.** A 10 % wash of a navy brand colour is
  invisible on a near-black card, so `accountColorVars()` emits a `-light` and a
  `-dark` member of every variable and `account-color.css` picks one under
  `.dark`. Never hard-code a single tint.
- **The rail mirrors in RTL.** It is `inset-inline-start` in CSS, not a Tailwind
  `left-0`. Arabic is a supported locale.
- **The rail sits at `z-index: 1`.** The wealth tile's click target is a full-bleed
  button at `z-0` whose hover wash would otherwise dull the rail.

## Files that matter

| File | Why |
|---|---|
| `src/lib/account-color.ts` | The resolver + the palette + the CSS-variable maths. Pure, no React, no DOM. |
| `src/lib/account-color.test.ts` | 18 tests. The palette-contrast one is a guard, not a formality. |
| `api/_lib/account-appearance.ts` | `pickAppearance(body)` — the only place a colour is validated. |
| `src/components/wealth/AccountAppearanceFields.tsx` | The Appearance block used by every account form. 44 px targets. |
| `src/components/wealth/account-color.css` | Only what Tailwind cannot say: the light/dark pair, the RTL rail, the icon halo. |
| `src/components/WealthAccountIcon.tsx` | Gained an `accent` prop (`tint` / `glass` / `glass-dark`) that reads the ancestor tile's variables. |
| `drizzle/0075_wealth_account_appearance.sql` | The two columns + their CHECKs. |

Surfaces wired up: `/wealth` tiles, `/spaces` cards, `/wealth/:id` balance hero +
header logo, `/spaces/:id` header. Deliberately **not** wired: account comboboxes,
the transfer wizard, transaction rows.

## Migration numbering — the trap on this repo

`dev`'s head was `0068`. **`0069`–`0074` are already taken by the unmerged
multi-currency branch (PR #370) and are already applied to the shared dev Neon
database.** A new migration numbered inside that range, or carrying a lower `when`
than `1788980400050`, reports "database schema is up to date" and silently never
runs. `0075` uses `when: 1789600000000`; it applied cleanly and both columns were
verified in `information_schema`.

Whoever merges #370 and this PR: the two touch `wealth_accounts` but no shared
column — the journal is the only conflict, and it resolves by keeping both entries in
`when` order.

## Two decisions left open (asked, not yet answered)

1. **Several Cash accounts share one green.** Cash is pinned to a fixed emerald so
   "the wallet" reads the same in every workspace. Multi-currency can leave a
   workspace with several cash accounts, and they come out identical until someone
   recolours them. The one-line alternative is to drop the `cash` short-circuit in
   `resolveAccountColor` so unbranded cash falls through to the per-row swatch.
2. **Whether the colour should follow the account into pickers and transaction rows.**
   That would colour-code the whole ledger. It is a materially bigger job and easy to
   overdo, so it was left out of this PR on purpose.

## State at handoff

Green: `secret-scan` · `check-esm-extensions` · `boot-functions` · route guards ·
`cache:check` · `i18n:check` (all 8 locales translated, no placeholders) · `lint` ·
`typecheck` · 893 unit tests. Both native shells re-synced
(`cap:sync:android`, `cap:sync:ios`).

One Windows-only gotcha worth knowing: `npx cap sync ios` on Windows rewrites the
`path:` entries in `ios/App/CapApp-SPM/Package.swift` with backslashes, which would
break the iOS build on a Mac. That file was reverted after the sync; the web-asset
copy into `ios/App/App/public` (gitignored) is the part that matters. **Do not commit
a `Package.swift` diff produced on Windows.**

Reviewed from real screenshots (1440 px + 390 px, light + dark) before the PR was
raised, per the usual loop.
