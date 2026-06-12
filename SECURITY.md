# Security

## Reporting

Email **matteo.schifano@reddoak.com** with a description and reproduction steps.
Please do not open public issues for vulnerabilities.

## Threat model (summary)

ProfitSync is a multi-tenant SaaS: every client, transaction, quotation, wealth
account and budget belongs to an **organization**. The core invariants:

- **Authentication**: Clerk JWTs, verified server-side on every request
  (`api/_lib/auth.ts`). No session state of our own.
- **Tenant isolation**: every DB query is scoped by `orgId` resolved from the
  authenticated membership — never by client-supplied ids alone.
- **Authorization**: role checks (`canWrite`/`canDelete`) before mutations;
  the `/admin` console requires `app_admins` membership with per-capability
  gating (`requireAdminCap`).
- **Money**: Dodo Payments is the Merchant of Record; our DB only mirrors
  subscription/invoice state. Webhooks are verified with the Standard Webhooks
  HMAC signature against per-environment secrets.
- **Uploads**: attachments/logos/avatars are validated server-side (extension +
  base64 sanity + size caps + magic-byte mime sniffing for images) and served
  with `X-Content-Type-Options: nosniff` and download dispositions.
- **Markdown/HTML**: blog content renders through `react-markdown` (no raw
  HTML) client-side and `sanitize-html` allowlists server-side; raw HTML
  injection (React's dangerous innerHTML API) is confined to the vendored
  `src/components/ui/` (enforced in CI).

## Automated checks

| Layer | What runs | Where |
|---|---|---|
| Pre-commit | Staged-diff secret scan (`scripts/secret-scan.mjs`; uses gitleaks when installed) → i18n → lint → typecheck → tests | `.husky/pre-commit` |
| CI: every PR + main/dev push | Full-tree secret scan · route auth-guard + raw-HTML sweep (`scripts/check-route-guards.mjs`) · `npm audit --omit=dev --audit-level=high` | `.github/workflows/security.yml` |
| CI: PRs to main | Playwright e2e suite against a dedicated database | `.github/workflows/e2e.yml` |

False positives in the secret scan: annotate the line with `secret-scan:ignore`
(reviewed in PR like any other change). New public (unauthenticated) API routes
must be added to the explicit allowlist in `scripts/check-route-guards.mjs`.

## Secret rotation runbook

1. Rotate the credential at the provider (Clerk / Dodo / Neon / Brandfetch).
2. Update Vercel env vars (all environments) + the GitHub Actions secrets.
3. If the secret was committed: rewrite is rarely worth it — treat the value as
   burned, rotate, and verify the scanner now blocks the pattern.
