# Quotation PDF — generate, store, presign, view / download / share

**Status:** in progress · **Owner:** Maqbool · **Started:** 2026-07-12
**Chain root:** `feat/qpdf-00-plan-maqbool` (off `dev`)

Auto-generate a **PDF** for every quotation in the company (Quotations) section and
let the user **view**, **download**, and **share** it (WhatsApp / email / any app via
the Web Share sheet). The heavy work (render + upload) runs on the **Go worker**; the
bytes live in **Hetzner Object Storage (S3-compatible)**; the app stores only the
object **key** and mints a **short-lived presigned URL on every access** so a link is
never permanently valid and can't be reached by an unauthenticated outsider.

---

## 1. Requirements (verbatim intent) → interpretation

| User said | How we implement it |
|---|---|
| "create the quotation automatically as a pdf" | Worker `pdf.quotation` job renders the PDF from a data snapshot. Generation is **lazy** — triggered on first view (and re-triggered when the quotation data changes). No blind pre-generation of PDFs nobody opens (cost-effective). |
| "view it, download it or share it … whatsapp or email or any other app" | Frontend PDF modal: **View** (open inline presigned URL), **Download** (presigned URL with `Content-Disposition: attachment`), **Share** (`navigator.share({url})` → native sheet → WhatsApp/email/etc.; copy-link fallback). |
| "worker will make pdf … saved to s3 … we use hetzner object storage" | Worker uses the already-wired `Deps.Storage` (minio-go) to `PutObject` into the private bucket. |
| "save the private url to the database, but the url should be short lived … maybe an hour or two, then invalid" | We store the **object key**, NOT a URL. The app presigns a fresh **1-hour** GET URL on each view. Expiry ⇒ dead link. |
| "if they click on the object next time, the pdf should be viewed/downloadable/shared … the new presigned shortlived key" | Every `GET /api/quotations/:id/pdf` re-presigns → a **new** short-lived URL each time. |
| "external person should not be able to access the API … secure" | The presign route requires Clerk auth + is **org-scoped** (an outsider gets 401; a member of another org gets 404). The bucket is **private** (no public URL); bytes are reachable **only** via a presigned URL minted by the authed route. The worker→app callback is gated by `requireServiceToken`. S3 credentials are **server-only**, never shipped to the browser. |
| "scalable, cost effective, industry standard, most modern" | Presign-on-read is the standard object-delivery pattern. Lazy generation + content-hash keys avoid regenerating unchanged PDFs. Pure-Go PDF (no headless Chrome) keeps the worker image tiny (Alpine, `CGO_ENABLED=0`). Dependency-free SigV4 in the app keeps the prod `npm audit` clean and the unit gate DB-free. |

**Assumption A1 — "save the url to the DB" means save the KEY.** The user later
clarified the presigned key must *change* on each access, which is impossible if a URL
is persisted. Storing the key + presigning on read is the only design that satisfies
"short-lived + regenerated each time". Recorded, proceeding.

**Assumption A2 — lazy (on-view) generation, not eager (on-create).** Cheaper (no
wasted renders), and re-render on edit is automatic via the content hash. A quotation
that's never opened never costs a render or a byte of storage.

**Assumption A3 — snapshot-in-payload, no read-callback.** The app sends a full data
snapshot in the enqueue payload so the worker never touches the app DB (isolation
invariant) and never needs a fetch-callback. Snapshot is tiny (single-amount
quotations, no line items) — far under the worker's 1 MB payload cap.

**Assumption A4 — v1 renders Latin script only.** maroto's built-in fonts are
Latin-1. Non-Latin quotation content (hi/ml/ta/te/ar prospect names/notes) will not
render glyphs until we embed a Noto font. Documented as a follow-up (§7), not a blocker
— the PDF chrome/labels are the org's own text and amounts render fine.

---

## 2. Architecture

```
┌─────────┐  GET /api/quotations/:id/pdf         ┌──────────────────────────────┐
│ Browser │ ───────────────────────────────────▶ │ App (Vercel fn, api/index.ts)│
│  modal  │ ◀── {status, view_url, download_url} │  requireAuth + org-scope     │
└─────────┘        (or {status:"generating"})     │  hash(current snapshot)      │
     ▲ poll every 2s while generating             │  if ready&&hash match →      │
     │                                            │     presign key (1h) ↩       │
     │                                            │  else → enqueue + "generating"│
     │                                            └───────────┬──────────────────┘
     │                                                        │ POST /v1/jobs
     │                                                        │  type=pdf.quotation
     │                                                        │  payload={snapshot,key}
     │                                                        ▼
     │                                            ┌──────────────────────────────┐
     │                                            │ Go worker (pdf.quotation)     │
     │                                            │  maroto v2 → PDF bytes        │
     │                                            │  Storage.Put(key, bytes)  ───▶│──▶ Hetzner S3 (private)
     │                                            │  ProfitSync.Call(callback)    │
     │                                            └───────────┬──────────────────┘
     │                                                        │ POST /api/internal/
     │                                                        │  quotations/pdf-ready
     │                                                        │  (service token)
     │  next poll returns ready + fresh presigned URLs        ▼
     └──────────────────────────────────────────  App sets pdf_status=ready, key, hash
```

**Object key:** `quotations/<org_id>/<quotation_id>/<source_hash>.pdf`
- Org-segmented ⇒ defence-in-depth against key guessing (real gate is org-scoped auth).
- `source_hash` = SHA-256 of the canonical snapshot ⇒ each data version is an
  **immutable** object; editing a quotation writes a *new* key, the row points at the
  latest, stale objects are simply never served (and can be lifecycle-expired later).

**Correctness gate = the hash, not the status column.** The view route always
recomputes `currentHash` from live data and only serves `pdf_object_key` when
`pdf_status==="ready" && pdf_source_hash===currentHash`. So an edit mid-generation can
never serve a stale PDF — it just re-enqueues for the new hash. `pdf_status` is UX
telemetry only.

**Race/idempotency:**
- Duplicate views while generating → worker `dedupe_key = qpdf:<id>:<hash>` collapses
  them (partial unique index on `status IN (queued,running)`).
- Worker retry/reap → stable key ⇒ re-upload is byte-identical; callback is idempotent
  (sets the same key/hash/ready).
- Stale callback (edit landed first) → still sets ready+oldHash; next view sees
  hash mismatch → re-enqueues newHash. Self-healing.

---

## 3. Branch chain (stacked, in dependency order)

Each branch is cut **from the previous one**. Naming: `feat/qpdf-NN-<task>-maqbool`.

| NN | Branch | Scope | Depends on | Status |
|----|--------|-------|-----------|--------|
| 00 | `feat/qpdf-00-plan-maqbool` | This plan doc | dev | ✅ pushed |
| 01 | `feat/qpdf-01-schema-maqbool` | Migration 0051 + `quotations` PDF columns + `Quotation` type | 00 | ✅ pushed |
| 02 | `feat/qpdf-02-presign-maqbool` | `api/_lib/s3.ts` config + `api/_lib/s3-presign.ts` (dependency-free SigV4) + unit test | 01 | ✅ pushed |
| 03 | `feat/qpdf-03-worker-maqbool` | Go worker `pdf.quotation` handler (maroto v2) + register + `go.mod` | 02 | ✅ pushed |
| 04 | `feat/qpdf-04-api-maqbool` | `enqueueQuotationPdf` + `GET /api/quotations/:id/pdf` + internal `pdf-ready` callback + register in `api/index.ts` + shared snapshot/hash lib | 03 | ✅ pushed |
| 05 | `feat/qpdf-05-ui-maqbool` | QuotationsPage PDF modal (view/download/share) + poll + i18n ×8 | 04 | ✅ pushed |
| 06 | `feat/qpdf-06-docs-env-maqbool` | CLAUDE.md env block + `.env.example` (app+worker) + `docs/quotation-pdf/SYSTEM.md` + memory note | 05 | ✅ pushed |

**Compare/PR URLs** (`gh` not authenticated → open these manually):
- 00 https://github.com/vorreix/profitsync/pull/new/feat/qpdf-00-plan-maqbool
- 01 https://github.com/vorreix/profitsync/pull/new/feat/qpdf-01-schema-maqbool
- 02 https://github.com/vorreix/profitsync/pull/new/feat/qpdf-02-presign-maqbool
- 03 https://github.com/vorreix/profitsync/pull/new/feat/qpdf-03-worker-maqbool
- 04 https://github.com/vorreix/profitsync/pull/new/feat/qpdf-04-api-maqbool
- 05 https://github.com/vorreix/profitsync/pull/new/feat/qpdf-05-ui-maqbool
- 06 https://github.com/vorreix/profitsync/pull/new/feat/qpdf-06-docs-env-maqbool

**Gate per branch (no `--no-verify`, ever):** secret-scan → check-esm-extensions →
boot-functions → i18n:check → lint → typecheck → test:ci (the husky pre-commit hook).

---

## 4. Per-task detail

### 01 — Schema (migration 0051)
Add to `quotations` (all non-null with defaults so the migration is safe on existing rows):
- `pdf_status text NOT NULL DEFAULT 'none'` — `none | generating | ready | error`
- `pdf_object_key text NOT NULL DEFAULT ''` — S3 key of the ready PDF (never a URL)
- `pdf_source_hash text NOT NULL DEFAULT ''` — hash of the snapshot the ready PDF was rendered from
- `pdf_size_bytes integer NOT NULL DEFAULT 0`
- `pdf_generated_at timestamp` (nullable)
- `pdf_error text NOT NULL DEFAULT ''` — last worker error (surfaced in the modal)

`Quotation` type in `src/lib/types.ts` gains the snake_case mirrors. Serialize is
automatic (camel→snake). **Migration gotcha:** bump the new `_journal.json` entry's
`when` above 0050's (`1783783818488`) then verify columns exist in
`information_schema` against the local Dev DB.

**Verify:** `npm run db:generate` produces 0051; apply to Dev DB; query
`information_schema.columns`; typecheck.

### 02 — App-side presigner (dependency-free SigV4)
- `api/_lib/s3.ts` — reads `S3_*` env (same names as the worker: `S3_ENDPOINT,
  S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_USE_SSL,
  S3_FORCE_PATH_STYLE`), exposes `isS3Configured()` + resolved config.
- `api/_lib/s3-presign.ts` — pure `node:crypto` **SigV4 query-string** presigner for
  GET. Supports signed `response-content-disposition` (attachment vs inline) and
  `response-content-type`. **Path-style** default (Hetzner + minio custom-endpoint
  default); virtual-hosted optional. No AWS SDK (keeps prod audit clean + unit gate
  DB-free).
- `presignGet(key, { expiresIn, disposition, filename, contentType })` → URL string.

**Verify (real, DB-free unit test):** assert the canonical request + signature against
a **known AWS SigV4 test vector** (hardcoded expected signature) so the crypto is
proven, not just "runs". `npx vitest run api/_lib/s3-presign.test.ts`.

### 03 — Worker `pdf.quotation` handler (Go, maroto v2)
- Add `github.com/johnfercher/maroto/v2` to `go.mod` (pure Go, CGO-free — fits the
  `CGO_ENABLED=0` Alpine Dockerfile; **confirm exact v2 API via context7 before
  writing** — v2 differs from v1's `m.Row/m.Col`).
- `internal/jobs/pdf_quotation.go`: `pdfQuotationHandler(d Deps)` —
  unmarshal snapshot → render (header w/ org name, prospect/company/contact block,
  amount + currency, date, notes, footer) → `d.Storage.Put(ctx, key, bytes, size,
  "application/pdf", 0)` (we ignore the returned URL; we only need the object at the
  key) → `d.ProfitSync.Call(ctx, "POST", "/api/internal/quotations/pdf-ready",
  callbackBody)` with `{quotation_id, organization_id, object_key, source_hash,
  size_bytes}`.
- Register `r.Register("pdf.quotation", pdfQuotationHandler(d))` in `RegisterAll`.
- Idempotent: stable key + same-value callback.

**Verify:** ⚠️ **DEFERRED — no Go/Docker in this environment.** Compile is verified at
build time by the Dockerfile (`go mod tidy && go build`) and in CI/deploy. Mitigation:
mirror existing handler patterns exactly, pin the maroto v2 API from context7 docs,
keep the handler minimal. Marked deferred honestly (§6).

### 04 — App API (enqueue + view route + callback)
- `api/_lib/worker-jobs.ts` → `enqueueQuotationPdf(snapshot, key, dedupeKey)` (mirrors
  `enqueueNotificationTickAt`; best-effort; POST `/v1/jobs` type `pdf.quotation`).
- `src/lib/quotation-pdf.ts` (import-free, shared) — `canonicalSnapshot(quotation,
  org)` + `snapshotHash(snapshot)` + `pdfObjectKey(orgId, id, hash)`. Pure ⇒
  unit-testable, no DB.
- `api/_routes/quotations/[id]/pdf.ts` — `GET`: auth + `requireBusinessFeature
  quotations` + org-scoped load → compute hash → ready&&match ⇒ presign view+download
  URLs (1h) & return; else enqueue + set `pdf_status=generating` + return
  `{status:"generating"}`. **405** on non-GET.
- `api/_routes/internal/quotations/pdf-ready.ts` — `POST`, `requireServiceToken`, then
  org+id-scoped update to `pdf_status=ready`, key, hash, size, `pdf_generated_at`.
- Register both in `api/index.ts` (static-before-dynamic; `["quotations", ":id",
  "pdf"]` and the internal path).

**Verify:** typecheck + `boot-functions` (imports every fn in real Node) +
`check-esm-extensions`; hash/key lib unit test; a throwaway DB test for the route if
feasible (deleted before commit). End-to-end (real worker+S3) **deferred to deploy**
(no local worker/S3 creds) — documented.

### 05 — Frontend (QuotationsPage PDF modal)
- New "PDF" action on each card row + in the detail modal (icon button).
- `QuotationPdfModal`: on open, `apiGet('/quotations/:id/pdf')`; if `generating`, poll
  every 2s (cap ~30 tries / 60s) with a spinner + "Generating your PDF…"; on `ready`
  show **View** / **Download** / **Share**; on `error` show the worker error + Retry.
- View = `window.open(view_url)`; Download = anchor to `download_url` (attachment
  disposition, CORS-free); Share = `navigator.share({title, text, url:view_url})` with
  copy-link fallback (mirror `ReferralPage`). Always-mounted, state-driven modal
  (StrictMode back-close footgun from memory).
- i18n: new keys under `quotations.pdf.*` in `en.json` **then all 7 other locales**
  (i18n:check gates the commit).

**Verify:** Playwright — open the modal, assert the generating→states render and the
three buttons appear, no new console errors. True generation needs the deployed
worker+S3, so the browser check asserts **UI states/wiring**; the byte-level
round-trip is deferred to deploy. Screenshot captured.

### 06 — Docs + env + memory
- CLAUDE.md: add the app-side `S3_*` env block (server-only note).
- `.env.example` (create if absent) + `worker/deploy/.env.example`: S3 write vs app
  read creds.
- `docs/quotation-pdf/SYSTEM.md`: the delivered architecture + ops notes + the
  Latin-only follow-up.
- Update this PLAN's change-log + statuses; write the memory note.

---

## 5. Security review (the user's hard requirement)

- **AuthN/Z:** `GET /api/quotations/:id/pdf` → `requireAuth` (401 for outsiders) +
  org-scoped query (404 cross-org) + `requireBusinessFeature("quotations")`.
- **Private bucket:** no `S3_PUBLIC_URL` for quotations; the *only* path to bytes is a
  presigned URL from the authed route. A raw key is useless without a signature.
- **Short-lived:** 1h expiry; every access re-presigns. A shared WhatsApp/email link
  dies after ~1h by design (matches "can only view for a certain period").
- **Secrets server-only:** `S3_*` live in Vercel/worker env, never in the client
  bundle. The presigned URL contains a *signature*, not the secret key.
- **Worker callback:** `requireServiceToken` (constant-time compare) — same gate as the
  notification cron. An outsider can't mark a PDF ready or point a row at a foreign key
  (update is id+org-scoped).
- **Key un-guessability:** org+uuid+hash path; even a guessed key needs a signature the
  outsider can't forge.

---

## 6. Verified vs deferred (honesty ledger)

| Check | Status | Why |
|---|---|---|
| Presigner crypto | ✅ **verified** — unit test vs AWS SigV4 vector (`s3-presign.test.ts`) | pure, DB-free |
| Snapshot/hash/key lib | ✅ **verified** — unit test incl. `updatedAt`-only loop guard (`quotation-pdf.test.ts`) | pure, DB-free |
| Migration columns | ✅ **verified** — applied to Dev DB, columns present in `information_schema` | local Dev DB available |
| API routes | ✅ **verified** — typecheck + `boot-functions` (imports every fn in real Node) + `check-esm-extensions` | real end-to-end needs worker+S3 |
| Frontend modal | ✅ **verified** — Playwright: all states (loading/generating/ready/unavailable/error+retry), both triggers (card + detail), desktop + mobile 390px, no new console errors | byte round-trip needs deploy |
| Full pre-commit gate per branch | ✅ **verified** — secret-scan → ESM-ext → boot-functions → route-guards → i18n (1499 keys/locale) → lint → typecheck → test:ci (398 tests) | ran green on every branch |
| Worker Go compile | ⛔ **DEFERRED** | no Go/Docker locally; CI/Dockerfile (`go mod tidy && go build`) compiles it — API pinned from context7 docs, handler mirrors existing patterns |
| End-to-end PDF round-trip | ⛔ **DEFERRED** | no local worker + no Hetzner creds; verify after deploy via `/admin → Worker` + presigned View/Download |
| PR creation | ⛔ **DEFERRED** | `gh` not authenticated → `pull/new/...` URLs recorded in §3 |

Nothing is silently skipped; each deferral has a reason and (where possible) a
mitigation.

## 7. Follow-ups (post-merge)
- Embed a Noto font in the worker for non-Latin scripts (A4).
- S3 lifecycle rule to expire superseded `<hash>.pdf` objects (cost).
- Optional: org logo in the PDF header (guard payload < 400 KB).

## 8. Change log
- 2026-07-12 — Plan authored; chain-root branch created.
- 2026-07-12 — Branches 01–05 implemented, gated, and pushed: schema (mig 0051),
  dependency-free SigV4 presigner + S3 config (unit-tested vs AWS vector), Go worker
  `pdf.quotation` handler (maroto v2), app API (enqueue + secure org-scoped view route +
  service-token `pdf-ready` callback + shared snapshot/hash lib, unit-tested), and the
  QuotationPdfModal (view/download/share, poll, i18n ×8, Playwright-verified states).
- 2026-07-12 — Branch 06: app `S3_*` read-cred block added to root `.env.example` +
  CLAUDE.md Environment (server-only); worker `.env.example` S3 section cross-referenced
  (write creds, keep bucket private); `SYSTEM.md` operating doc written; branch-chain
  statuses + honesty ledger updated; memory note recorded. Chain complete (00–06 pushed).
