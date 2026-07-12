# Notifications V5 — event coverage, native FCM push, reliability

Status: **in progress** · Started 2026-07-11 · Chain root: `feat/notif5-00-plan` (off `dev`)

## Decisions (locked with the user)

- **Push provider:** FCM (HTTP v1) is the ONE native sender for **both Android and
  iOS** — the `@capacitor-firebase/messaging` plugin returns a unified FCM token on
  both platforms (Firebase wraps APNs on iOS; one-time `.p8` upload to the Firebase
  console when the iOS shell lands). **Web keeps VAPID web-push** (already built,
  self-healing, free, no Google hop) per `docs/notifications/PUSH_PROVIDER_DECISION.md`.
  No paid vendor (OneSignal/SNS/…) — they charge for orchestration we already own
  (cascade, dedupe, broadcast studio, push_events). Total incremental cost: $0
  (FCM free on Spark, no message limits; 600k msgs/min quota).
- **Scope:** all three phases, in order: events → FCM → reliability.
- **Noise defaults: conservative.** On by default: billing (payment success/failure,
  plan changes), budget warnings, quotation accepted, member invited/joined,
  referral credited. Peer activity (teammate edits transactions/clients) stays
  OPT-IN — not wired in V5.
- **Channel model:** preference channel `mobile_push` (one user-facing toggle for
  phone pop-ups) maps to transport rows `push_subscriptions.channel='fcm'` (and
  later `'apns'` if ever needed — FCM-for-iOS makes that unlikely). `web_push`
  preference ↔ `web_push` subscription rows, unchanged.
- **Branch discipline:** stacked branches off `dev`, each gated + pushed; PRs are
  opened by the user (`gh` unauthenticated). **Nothing is merged to dev by the agent.**

## Branch chain

| # | Branch | Delivers | Status |
|---|--------|----------|--------|
| 00 | `feat/notif5-00-plan` | This plan | ✅ pushed |
| 01 | `feat/notif5-01-events-billing` | `payment_succeeded` + `subscription_changed` fired from webhook AND reconcile (+ admin transitions) | ✅ pushed |
| 02 | `feat/notif5-02-events-team` | `member_invited` (admins), org-wide join fan-out, `quotation_accepted` | ⏳ |
| 03 | `feat/notif5-03-events-money` | `budget_warning` @80%, `recurring_posted`, `referral_credited`/`referral_payout` (new types) | ⏳ |
| 04 | `feat/notif5-04-fcm-server` | FCM HTTP v1 sender (node:crypto JWT, lazy, no-op w/o env), channel-aware `POST /api/notifications/push`, `mobile_push` preference channel | ⏳ |
| 05 | `feat/notif5-05-fcm-client` | `@capacitor-firebase/messaging`, native token registration, Mobile-push toggle UI, conditional gradle wiring, docs | ⏳ |
| 06 | `feat/notif5-06-reliability` | GH tick workflow fails loud on stale heartbeat, worker-deploy schedule registration, rate-limit on subscription POST, ops checklist | ⏳ |

## Ground truth (audited 2026-07-11, 4-agent fan-out with file:line evidence)

- Core pipeline healthy: `createNotification` (api/_lib/notifications.ts) resolves
  the client→org→user cascade, inserts in_app row, fire-and-forget web push;
  race-safe dedupe on partial unique `(user_id, dedupe_key)`; bell polls
  unread-count every 60s + visibilitychange (works in the Android WebView today).
- **Only 8 events fire.** Six registered types NEVER fire: `member_invited`,
  `payment_succeeded`, `subscription_changed`, `budget_warning`,
  `recurring_posted`, `quotation_accepted` (verified: no call sites).
- Native app has NO push: SW intentionally skipped in WebView
  (src/lib/pwa/register-sw.ts); `push_subscriptions.channel` + the sender seam in
  api/_lib/push.ts were designed for `fcm` — no schema change needed.
- Reliability: GH fallback cron (.github/workflows/notification-tick.yml) silently
  no-ops until the `PROFITSYNC_CRON_TOKEN` repo secret is set; worker schedule
  registration is manual (root cause of the June 2026 11-day silent outage);
  heartbeat exists (`notification_scheduler_state`) but nothing alerts on staleness.

## Working conventions (apply to every branch)

- Event sites call `void createNotification({...}).catch(() => {})` /
  `notifyOrgMembers` — best-effort, NEVER blocks the originating action.
- Every event passes a stable `dedupeKey`; recurring occurrences include the
  occurrence in the key (recurring-broadcast lesson).
- i18n: `data.i18nKey = "types.<type>.title"` + `i18nBodyKey` + `i18nParams`;
  add keys to en.json first, translate ALL 8 locales (i18n:check gates commits).
- Billing events fire from BOTH the webhook AND the reconcile path (activation
  never depends on webhooks — same rule as referral crediting). Idempotency via
  dedupeKey, e.g. `payment_ok:<paymentId>`.
- DB-touching verification = throwaway `*.test.ts` run against `.env.local`,
  deleted before commit. Committed tests stay DB-free.
- Full pre-commit gate before every push; no `--no-verify`; branch pushed, PR
  opened by the user.

## Per-branch details

### 01 — billing events
- `payment.succeeded` webhook handler (api/billing/webhook.ts) + invoice reconcile
  (api/_lib/billing-sync.ts `reconcileInvoices`): notify org owners+admins,
  type `payment_succeeded`, dedupe `payment_ok:<providerInvoiceId>`, link `/subscription`.
- `subscription_changed`: fire where plan_key/status actually transitions —
  webhook subscription.* branches, reconcile status change, self-serve
  change-plan/cancel/resume, admin plan actions. Params carry old→new plan/status;
  dedupe `sub_changed:<orgId>:<newPlan>:<newStatus>:<periodEnd>`.
  past_due/cancelled reuse this type (status params), keeping the type registry stable.

### 02 — team events
- `member_invited`: on invitation POST → notify owners/admins (not the invitee —
  they get the email), dedupe `invited:<invitationId>`.
- Join fan-out: on invitation acceptance, extend the existing inviter-only
  `invitation_accepted` with `notifyOrgMembers` to owners/admins (exclude inviter +
  joiner), dedupe per invitation+recipient.
- `quotation_accepted`: quotations/[id] PATCH status→accepted AND /convert →
  notify quotation creator + owners/admins, link to the quotation.

### 03 — money events
- `budget_warning`: api/_lib/notify-budget.ts gains an 80% threshold check
  (fires once per budget window via dedupe, like budget_exceeded; skips if
  already exceeded).
- `recurring_posted`: api/_lib/recurring-materialize.ts — for materialized
  non-transfer rules notify the rule creator, one notification per rule per
  materialization run (`recurring:<ruleId>:<cursor>`), like space_autosaved.
- NEW types `referral_credited` + `referral_payout` (category `billing`):
  credited fires from `creditReferralOnPaid` (webhook AND reconcile call it);
  payout status changes fire from admin payout PATCH. Registry + en.json + 8 locales.

### 04 — FCM server
- `api/_lib/push-fcm.ts`: FCM HTTP v1 sender. OAuth2 token minted from the
  service-account JSON (`FCM_SERVICE_ACCOUNT_JSON` env, base64 or raw JSON) with
  a hand-rolled RS256 JWT via `node:crypto` — NO new npm dependency. Lazy import,
  no-ops without env (VAPID pattern), never throws, prunes dead tokens
  (UNREGISTERED/INVALID_ARGUMENT), logs to push_events (source `fcm`).
- Fan-out: notification send queries subscriptions by user and dispatches per
  `channel` — web_push → existing sender; fcm → new sender. Preference channel
  `mobile_push` added to NOTIFICATION_CHANNELS (defaults mirror web_push:
  on for team/billing/budget) — sanitize/cascade/UI pick it up structurally.
- `POST /api/notifications/push` accepts `channel: 'fcm'` (token in `endpoint`,
  no p256dh/auth keys, platform `android`/`ios`).
- Committed unit tests (DB-free): JWT assembly against a throwaway test key,
  sender no-op without env, channel dispatch.

### 05 — FCM client
- `@capacitor-firebase/messaging` (+ firebase gradle bits). google-services.json
  stays gitignored; gradle applies the plugin ONLY when the file exists so builds
  never break without it.
- Native boot (isNativeAndroid): request permission on a user gesture
  (settings toggle, same UX as PushToggle), register token → POST /api/notifications/push
  {channel:'fcm'}, re-sync on app start (ensureSubscriptionSynced pattern),
  foreground pushes → in-app toast; tap → deep link route.
- Firebase project provisioning attempted via the firebase MCP tooling; if the
  account isn't linked, code no-ops and docs give exact console steps + env names.
- Docs: ANDROID.md push section + SYSTEM.md channel table + .env example.

### 06 — reliability
- notification-tick.yml: after the tick, query heartbeat age via a tiny status
  response from the cron route; FAIL the workflow when stale (GitHub emails on
  red) instead of silently no-op'ing; also fail loud when the secret is missing
  on scheduled runs (one clear log line, neutral exit).
- Worker: `make deploy` (and docs) chain `make register`; register script becomes
  idempotent-verified (GET /v1/schedules after POST).
- Rate-limit POST /api/notifications/push per user (in-process LRU, auth-cache pattern).
- Ops checklist in SCHEDULER.md: PROFITSYNC_CRON_TOKEN GitHub secret,
  FCM_SERVICE_ACCOUNT_JSON Vercel env, worker env, one-look health checklist.

## Verification matrix

| Branch | Proof |
|---|---|
| 01–03 | Throwaway DB test per event site (handler-level, stubbed auth) + Playwright bell check on dev server + gate |
| 04 | Committed DB-free unit tests (JWT/dispatch/no-op) + gate |
| 05 | Android emulator: token registration + test push end-to-end if Firebase creds exist, else no-op path (no crash, toggle hidden) + gate |
| 06 | Workflow dry-run via manual dispatch + gate |

## Change log

- 2026-07-11: plan written; audit findings recorded; chain started.
- 2026-07-11 (01): `api/_lib/notify-billing.ts` — `notifyPaymentSucceeded`
  (7-day recency guard for reconcile backfills, dedupe `payment_ok:<paymentId>`)
  + `notifySubscriptionChanged` (pure `isNoteworthySubscriptionChange`: plan
  changes always, status only → active/cancelled; day-stamped dedupe collapses
  webhook+reconcile double-fire). Wired at 7 sites: webhook payment.succeeded +
  subscription branch, reconcileInvoices + reconcileSubscriptionFromDodo,
  admin subscriptions PATCH, admin organizations PATCH, admin bulk actions.
  Self-serve cancel/resume intentionally skipped (end-of-period cancel doesn't
  change status; the actor did it themselves). i18n ×8 (1461 keys). Committed
  pure test api/_lib/notify-billing.test.ts; DB-verified with a throwaway test
  (notify/dedupe/recency/body-variant all proven against the dev DB, cleaned up).
