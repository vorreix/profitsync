# AI Quick Add (NL parse + receipt OCR) — Design Spec

*2026-07-19. Research basis: `docs/ai-quick-add/RESEARCH.md` (cost model, model selection, competitor packaging, accuracy findings).*

## What

A **smart input bar at the top of the existing `AddTransactionDialog` body** (the single Add-Transaction modal reused by the FAB and all pages). Type a sentence ("lunch with Acme, 450 yesterday") or attach/shoot a receipt photo → the form fields below prefill with per-field confidence. The AI never writes to the DB; the user always reviews and saves through the existing flow.

## Decisions (locked)

| Decision | Value |
|---|---|
| Provider / model | Anthropic API direct, `AI_PARSE_MODEL` env (default `claude-haiku-4-5`). `ANTHROPIC_API_KEY` optional — feature hidden when absent (same degrade pattern as Resend/S3/VAPID). |
| Quotas | `plans.limits.aiParsesPerMonth`: free **20**/mo, premium **500**/mo. Metered in new `ai_usage` table (org+month counter). 403 + upgradeHint like every other quota. |
| Entry point | Smart bar in `AddTransactionDialog` only (v1). Parser API is reusable for a future dedicated capture flow. |
| Client matching | **Hybrid**: model returns a raw name guess; **server** resolves against org clients (normalize → exact → prefix/contains → Jaro-Winkler ≥0.88). Ambiguous → return candidates for inline chips. Model never emits IDs. |
| Category matching | Model picks from the org's provided list; server keeps only exact (ci) matches, else null. |
| Image path | Client-side canvas preprocess: EXIF-orientation normalize + downscale ≤1568px long edge + JPEG q0.8 (fixes rotation accuracy collapse AND caps tokens/upload). |
| Receipt bonus | Parsed receipt image is added to `pendingFiles` so it's attached to the created transaction. |
| Abstention | Every parsed field nullable; low-confidence fields left EMPTY, listed in the result strip. Never auto-save. |

## API

### `GET /api/ai/quota` → `{ enabled, remaining, limit, plan_key }`
`enabled=false` when `ANTHROPIC_API_KEY` unset. Drives bar visibility + exhausted state.

### `POST /api/ai/parse-transaction`
Body: `{ text?: string, image?: { data: string (base64, no data: prefix), media_type: "image/jpeg"|"image/png"|"image/webp" } }` — at least one required. Image ≤ 1.5 MB base64.

Guards in order: `requireAuth` → `canWrite(role)` 403 → quota check (`ai_usage` count vs limit) 403 `{ reason: "aiParsesPerMonth", upgradeHint: true }` → 503 if key unset.

Server builds prompt with: fixed parser-only system prompt (injection-hardened), today's date (org-agnostic UTC), org currency, org client names (≤100), org category names by type. Calls model with structured output (JSON schema, `additionalProperties: false`, per-field confidence 0–1, reasoning-before-answer field order). Server validates with zod, range-checks amount (`amountExceedsLimit`), resolves client + category, increments `ai_usage` on success.

Response:
```json
{
  "fields": { "type": "outgoing", "amount": 450, "date": "2026-07-18", "category": "Food"|null,
               "description": "Lunch with Acme", "client_id": "…"|null },
  "confidence": { "type": 0.98, "amount": 0.95, "date": 0.8, "category": 0.6, "client": 0.9 },
  "client_candidates": [{ "id", "name" }] | null,   // when fuzzy match is ambiguous (2-3 close hits)
  "raw_client_name": "Acme" | null,
  "remaining": 17
}
```

Errors: 422 `{ error: "unparseable" }` when the model can't extract anything usable; standard 4xx/5xx otherwise. No model/vendor details leak to the client.

### Schema (mig 0056)
`ai_usage`: `id uuid pk, organization_id fk→organizations cascade, period text ("YYYY-MM"), count int default 0, updated_at` — unique (organization_id, period). Upsert-increment on success.

## UI

### Component: `src/components/transactions/SmartAddBar.tsx`
Props: `{ onApply(fields, confidence): void; onUndo(): void; onAttachReceipt(file: File): void; clientCandidatesPick(id: string|null): void }` — self-contained quota fetch (`apiGet`, cached), state machine `idle | parsing | applied | error | exhausted`, camera input, ambiguity chips.

### States
1. **Idle**: rounded `bg-muted/40` container, `Sparkles` icon (`text-primary`), textarea (16px font, auto-grow ≤2 rows, `enterKeyHint="go"`), trailing icon buttons ≥44px: camera (`<input type=file accept=image/* capture=environment>`) and parse (visible when text). Placeholder localized + currency-aware. Remaining count shown only when ≤5.
2. **Parsing**: border shimmer (transform/opacity only, `prefers-reduced-motion` respected); receipt shows thumbnail chip w/ shimmer; parse button → cancel (AbortController). Form below stays interactive.
3. **Applied**: result strip `✨ Filled N fields · check <fields>  [Undo]`; staggered per-field highlight pulse (~50ms apart, `bg-primary/10` fade) via `aiMeta` in the dialog; medium-confidence fields get an amber hint dot on their label; low-confidence left empty + named in strip. `aria-live="polite"` announcement. Ambiguous client → chips row `Did you mean: [A] [B] [None]`.
4. **Exhausted** (quota=0): bar becomes upsell — `✨ You've used your N free AI fills  [Upgrade]` → existing `goUpgrade`. Input disabled but bar visible.
5. **Error**: inline message with recovery text, input preserved, retry.

### Dialog integration (`AddTransactionDialog`)
- Renders `SmartAddBar` above `TxFormFields` (only when quota `enabled`).
- Holds `preAiSnapshot` (form + pendingFiles) for Undo, and `aiMeta: Record<fieldKey, "high"|"medium">` to drive highlights; a manual edit of a field clears its meta.
- `onApply` maps parsed fields → `TxForm` patch (allocation uses `defaultAccountId(accounts)`); receipt file appended to `pendingFiles`.
- Free-plan client_id requirement etc. unchanged — the AI only prefills the same form.

### tx-form
`TxFormFields` gains optional `aiFields?: Record<string, "high" | "medium">` and applies a pulse class + amber dot on matching field labels. No behavior change when undefined.

## i18n
New keys in `transactions` ns (`ai.*`): placeholder, parse, parsing, filledSummary, checkFields, undo, didYouMean, none, quotaLow, quotaExhausted, upgrade, errorUnparseable, errorGeneric, receiptUnreadable, cameraLabel. All 8 locales (gate enforces).

## Testing
- DB-free unit tests: `src/lib/ai-match.test.ts` (fuzzy client resolution incl. diacritics/ambiguity) and response-validation (zod schema accepts/rejects, amount range).
- e2e safety: bar renders only when `enabled` — CI has no `ANTHROPIC_API_KEY`, so existing smoke tests see an unchanged modal.
- Manual: browser pass of all 5 states; native parity via `cap:sync:android` + `cap:sync:ios`.

## Out of scope (v1)
Voice UI (OS keyboard dictation covers it), batch receipt import, dedicated FAB capture flow, auto-save, model fallback routing, Gemini adapter (pre-designated cost lever — see RESEARCH §8.5).

---

## v2 addendum (2026-07-19): multi-provider + voice input

- **Provider abstraction** (`api/_lib/ai-providers.ts`): Anthropic (SDK) / Gemini (REST `generateContent`, `responseSchema` in nullable dialect via `src/lib/ai-schema.ts`, `thinkingBudget: 0`) / OpenAI (REST chat.completions, strict json_schema). Selected by `AI_PROVIDER` + `AI_PARSE_MODEL` env; defaults per provider: `claude-haiku-4-5` / `gemini-2.5-flash` / `gpt-5.4-mini`. Operator preference: **Gemini 2.5 Flash** ($0.30/$2.50 per MTok; audio input $1.00/MTok).
- **Voice quick add**: mic button in the capture view (shown only when the provider supports audio — Gemini only; OpenAI mini tier and Anthropic have no audio input). MediaRecorder → decode → 16 kHz mono WAV (`src/lib/audio-wav.ts`) because Gemini inline audio accepts only wav/mp3/aiff/aac/ogg-vorbis/flac — NOT the webm/m4a that MediaRecorder produces. Recording UI: pulsing dot + tabular timer `0:12 / 0:30` + progress bar (scaleX) + cancel/stop; auto-stop at the per-plan ceiling.
- **Limits**: recording 30 s free / 60 s premium (`maxRecordSeconds`, enforced by auto-stop + per-plan audio payload caps 1.5/3 MB b64); monthly quota free bumped 20 → **30** (user-set), premium 500. Audio ≈32 tokens/s → a 60 s parse ≈ $0.004 on Gemini.
- **Account matching**: schema + prompt gain `account_name` ("from account A", "paid by cash"); server resolves against the org's wealth accounts (nickname||bank_name||"Cash") with the same fuzzy matcher; matched account drives the allocation's source account, else default. Ambiguous account abstains (no chip flow).
- **Native**: `RECORD_AUDIO` (+`MODIFY_AUDIO_SETTINGS`) in AndroidManifest — Capacitor auto-bridges WebView mic permission; `NSMicrophoneUsageDescription` in iOS Info.plist (WKWebView getUserMedia ≥ iOS 14.3).
