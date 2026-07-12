# Quotation PDF — system & operations

**What it is:** every quotation can be rendered to a **PDF** and **viewed / downloaded /
shared** (WhatsApp, email, or any app via the native share sheet) from the Quotations
page. Rendering runs on the **Go worker**; the bytes live in a **private S3 bucket**
(Hetzner Object Storage); the app stores only the object **key** and mints a **fresh,
short-lived presigned URL on every access** — so a shared link expires on its own and an
unauthenticated outsider can never reach the file.

This is the operating doc (mental model, invariants, where things live, how to run/verify
it). For the design rationale and the branch-by-branch build log, see
[`PLAN.md`](./PLAN.md).

---

## Mental model (internalize first)

- **Presign-on-read, never persist a URL.** The DB row holds the object **key** only.
  Each `GET /api/quotations/:id/pdf` re-presigns a **1-hour** GET URL. There is no
  long-lived link anywhere; regeneration of the *link* is free and automatic.
- **The hash is the cache gate, not the status column.** The view route recomputes a
  SHA-256 of the live snapshot every time and serves the stored object **only** when
  `pdf_status === "ready" && pdf_source_hash === currentHash`. Edit a quotation → the
  hash flips → the old PDF is silently never served and a new render is enqueued.
  `pdf_status` is UX telemetry, not a correctness gate.
- **The app owns the key + hash; the worker just renders.** The app builds the snapshot,
  hashes it, derives the key `quotations/<org>/<quote>/<hash>.pdf`, and enqueues. The
  worker renders the snapshot and `PutObject`s to that exact key. The worker never
  touches the app DB (the worker's isolation invariant holds).
- **Two credential sets, same `S3_*` names.** The **app** holds READ creds (to presign);
  the **worker** holds WRITE creds (to upload). One Hetzner key can serve both, or split
  them. Both are **server-only** — the browser only ever gets a presigned URL (a
  signature, not the key).
- **Lazy generation.** A PDF is rendered on first view (and re-rendered when the content
  changes), never eagerly on create. A quotation nobody opens costs zero renders and zero
  bytes.

## Invariants — do not break these

1. **Store the KEY, never a URL.** Persisting a presigned URL would make it either
   permanently valid (insecure) or permanently dead after 1h (broken). The key + presign-
   on-read is the only design that satisfies "short-lived AND re-viewable later".
2. **The bucket stays PRIVATE.** No `S3_PUBLIC_URL` for quotations. The presigned URL from
   the authed, org-scoped route is the ONLY path to the bytes.
3. **`S3_*` are server-only secrets.** Never add a `VITE_` mirror; never log them; never
   send them to the client. The presigned URL carries a signature, not the secret.
4. **The view route is Clerk-authed + org-scoped + business-gated.** Outsider → 401;
   member of another org → 404; personal (non-business) account → gated by
   `requireBusinessFeature("quotations")`.
5. **The worker callback is service-token-authed + id/org-scoped.** `pdf-ready` uses
   `requireServiceToken` (constant-time compare) and can only mark the specific
   quotation ready — it can't point a foreign row at an attacker-controlled key.
6. **The `generating` write must NOT bump `updated_at`.** The snapshot hash is derived
   from content (which includes `updated_at` as the `generated_at` display stamp source —
   but that field is **excluded** from the hash). The status write sets only `pdf_*`
   columns; likewise the `pdf-ready` callback. Bumping `updated_at` would churn the hash
   and loop forever. (Guarded by a unit test: `snapshotHash` is stable across an
   `updatedAt`-only change.)
7. **Keys are content-immutable.** Each data version is its own `<hash>.pdf` object.
   Editing writes a NEW key; the row points at the latest; stale objects are simply never
   served (and can be lifecycle-expired later — see follow-ups).

## Where everything lives

**App (Vercel):**
- `api/_lib/s3.ts` — `getS3Config()` / `isS3Configured()` / `presignGetObject(cfg, key,
  {expiresIn, disposition, filename, contentType})`. Reads `S3_ENDPOINT, S3_REGION,
  S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_USE_SSL, S3_FORCE_PATH_STYLE`.
- `api/_lib/s3-presign.ts` — dependency-free `node:crypto` **SigV4 query-string**
  presigner (no AWS SDK → prod `npm audit` stays clean, unit gate stays DB-free).
- `api/_lib/quotation-pdf.ts` — the shared contract: `buildQuotationSnapshot`,
  `snapshotHash` (excludes `generated_at`), `pdfObjectKey`, `quotationReference`,
  `quotationPdfFilename`. Pure `node:crypto` — unit-tested in `quotation-pdf.test.ts`.
- `api/_lib/worker-jobs.ts` — `enqueueQuotationPdf(...)` (POST worker `/v1/jobs`, type
  `pdf.quotation`, dedupe `qpdf:<id>:<hash>`), `isWorkerConfigured()`.
- `api/_routes/quotations/[id]/pdf.ts` — `GET` the modal polls. Ready+match → presign
  view(inline)+download(attachment) @ 1h → 200; not configured → 503; else enqueue +
  mark generating → 202.
- `api/_routes/internal/quotations/pdf-ready.ts` — `POST` worker callback
  (`requireServiceToken`); sets `pdf_status=ready`, key, hash, size, `pdf_generated_at`.
- Both registered in `api/index.ts` (static-before-dynamic).
- `src/components/QuotationPdfModal.tsx` — the delivery state machine (loading →
  generating (poll 2s, ≤~90s) → ready | unavailable | error+retry). View =
  `window.open`; Download = anchor to the attachment URL; Share = `navigator.share`
  (copy-link fallback). Wired into `src/pages/QuotationsPage.tsx` (card row + detail
  modal).
- i18n: `quotations.pdf.*` (18 keys) in all 8 locales.
- Schema: `quotations.pdf_status | pdf_object_key | pdf_source_hash | pdf_size_bytes |
  pdf_generated_at | pdf_error` (migration **0051**); `Quotation` type mirrors in
  `src/lib/types.ts`.

**Worker (Go, self-hosted):**
- `worker/app/internal/jobs/pdf_quotation.go` — `pdf.quotation` handler: unmarshal
  snapshot → `renderQuotationPDF` (maroto v2, A4, header / prepared-for / subject / notes
  / total / footer) → `Storage.Put(key, bytes, "application/pdf")` → `ProfitSync.Call
  POST /api/internal/quotations/pdf-ready`. Registered in `RegisterAll`.
- `worker/app/internal/storage/` — minio-go S3 client (`Deps.Storage`).
- maroto v2 dependency in `worker/app/go.mod`.

## Request flow

```
Browser modal ──GET /api/quotations/:id/pdf──▶ App (requireAuth + org-scope + business)
   ▲  poll 2s while generating                   │ hash(live snapshot)
   │                                             ├─ ready && hash match → presign 1h → 200 {view_url, download_url}
   │                                             ├─ !S3 || !worker → 503 {unavailable}
   │                                             └─ else → enqueue(dedupe qpdf:<id>:<hash>) + pdf_status=generating → 202
   │                                                         │ POST worker /v1/jobs (pdf.quotation)
   │                                                         ▼
   │                                             Go worker: maroto → bytes → S3.Put(key) (Hetzner, private)
   │                                                         │ POST /api/internal/quotations/pdf-ready (service token)
   │  next poll → 200 with fresh presigned URLs   ◀──────────┘ App sets pdf_status=ready, key, hash, size
```

## Configuration / running it

The feature is **fully optional and self-disabling** — with nothing set, the modal shows
"PDF generation is not available" (503) and nothing else breaks.

To turn it on you need **both** halves configured:

1. **App (Vercel env or `.env.local`)** — the READ credentials (see `.env.example` → the
   `S3_*` block, and CLAUDE.md → Environment):
   ```
   S3_ENDPOINT=fsn1.your-objectstorage.com   # host only, no scheme
   S3_REGION=us-east-1
   S3_BUCKET=<private-bucket>
   S3_ACCESS_KEY=…                            # server-only
   S3_SECRET_KEY=…                            # server-only
   S3_USE_SSL=true
   S3_FORCE_PATH_STYLE=true                   # Hetzner/MinIO; false = virtual-hosted
   ```
   Plus the worker link (already used by the notification system): `WORKER_BASE_URL`,
   `WORKER_API_TOKEN`, and `PROFITSYNC_SERVICE_TOKEN`.
   > `vercel dev` reads the **cloud** Development env, not `.env.local`. Set with
   > `vercel env add` and redeploy/restart. `npm run dev` (Vite full-stack via
   > `localApiPlugin`) reads `.env.local`.

2. **Worker (`worker/deploy/.env`)** — the WRITE credentials under the SAME `S3_*` names
   (see `worker/deploy/.env.example`). **Leave `S3_PUBLIC_URL` blank** — quotation PDFs
   require a private bucket. Also set `PROFITSYNC_BASE_URL` + `PROFITSYNC_SERVICE_TOKEN`
   (same token as the app) so the `pdf-ready` callback authenticates. Deploy per
   `docs/worker/DEPLOYMENT.md`; the worker registers the `pdf.quotation` handler at boot.

**Hetzner bucket:** create a private bucket in your Object Storage project; issue an
access key. `S3_ENDPOINT` is the region host (e.g. `fsn1.your-objectstorage.com` for
Falkenstein). Path-style is correct for Hetzner (`S3_FORCE_PATH_STYLE=true`).

## Security summary (the user's hard requirement)

| Threat | Mitigation |
|---|---|
| External person hits the API | `requireAuth` → 401; org-scoped query → 404 cross-org; `requireBusinessFeature("quotations")`. |
| Guessing the object key | Key = `org/uuid/sha256.pdf`; even a correct guess is useless without a valid signature the outsider can't forge. Bucket is private. |
| Shared link lives forever | 1h presign; every access re-presigns. A WhatsApp/email link dies on its own. |
| Secret leakage to the browser | `S3_*` are server-only; the client only ever receives a presigned URL (signature, not key). |
| Forged "ready" callback | `requireServiceToken` (constant-time); update is id+org scoped — can't point a foreign row at an attacker key. |

## Verifying changes

- **App unit (DB-free):** `npx vitest run api/_lib/s3-presign.test.ts` (SigV4 vs a known
  AWS test vector) and `npx vitest run api/_lib/quotation-pdf.test.ts` (snapshot/hash/key
  — incl. the "stable across `updatedAt`-only change" loop guard).
- **App boot/imports:** `node scripts/boot-functions.mjs` + `node
  scripts/check-esm-extensions.mjs` (the two prod-parity guards) — both run in the hook.
- **Frontend states:** open the modal in a browser; the loading/generating/ready/
  unavailable/error+retry states are drivable without live S3 (503 renders as
  `unavailable`).
- **Worker compile:** `docker build -f worker/app/build/Dockerfile worker/app` (runs `go
  build` in the golang container; also verified in CI/deploy). No local Go needed.
- **End-to-end (real bytes):** requires a deployed worker + Hetzner creds — enqueue a
  view, watch the job reach `done` in `/admin → Worker`, confirm the row flips to
  `pdf_status=ready`, then View/Download the presigned URL.

## Known limits / follow-ups (post-merge)

- **Latin-only glyphs (v1).** maroto's built-in fonts are Latin-1; non-Latin content
  (hi/ml/ta/te/ar prospect names/notes) won't render until a Noto font is embedded in the
  worker. Amounts use the currency **code** (e.g. `INR 1,200.00`) on purpose to avoid
  symbol tofu. The org's own labels/chrome render fine.
- **S3 lifecycle rule** to expire superseded `<hash>.pdf` objects (cost control).
- **Org logo** in the PDF header (guard the enqueue payload well under the worker's 1 MB
  cap).
