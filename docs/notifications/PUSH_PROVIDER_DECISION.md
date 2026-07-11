# Decision: keep VAPID web-push — do not migrate to Firebase/FCM

**Date:** 2026-07-11 · **Status:** decided · **Context:** after the June '26
"notifications silently stopped" incident, migrating web push to Firebase Cloud
Messaging was proposed as the way to "do things properly". This document records
why we are staying on the standards-based `web-push` (VAPID) pipeline.

## Why FCM would not have helped

1. **Same wire, extra hop.** Web push from FCM is delivered by the *same* browser
   push services we already use (Chrome → FCM transport, Firefox → Mozilla
   autopush, Safari/iOS PWA → Apple's push service). VAPID web-push talks to
   those services directly; FCM adds Google's routing layer in front of them.
   Delivery reliability at the device does not improve.
2. **The outage was the driver, not the channel.** The June '26 failure was the
   self-hosted worker no longer POSTing `/api/cron/notifications`, so reminders
   and scheduled broadcasts were never *created*. FCM sends nothing that was
   never triggered. The real fixes are redundancy + observability: the tick
   heartbeat, the DOWN alert in `/admin → Worker`, schedule auto-repair, and the
   GitHub Actions fallback driver (see `SCHEDULER.md`).
3. **A second service worker is a regression risk we've paid for before.** FCM's
   web SDK wants its own `firebase-messaging-sw.js`. Our SW pipeline
   (`app-sw.js` + `push-sw.js` via importScripts + the reserved `/sw.js`
   kill-switch) is deliberately single-worker after the permanent-white-screen
   incident ([[pwa-white-screen-deploy]]); introducing a second registration
   scope re-opens that class of bug for zero delivery gain.
4. **iOS is not unlocked by FCM.** iOS 16.4+ supports web push only for
   installed PWAs, through Apple's push service — identically for VAPID and FCM.
5. **Lock-in and surface area.** FCM adds a Google Cloud project, credentials in
   Vercel, quota/ToS coupling, and a heavier client bundle. `web-push` is ~0
   client bytes (the browser API is native) and one tiny server dep, lazily
   imported.

## What "properly working" means here instead

Shipped in branches `feat/maqbool-04`/`-05`:

- **Liveness:** `notification_scheduler_state` heartbeat on every tick + red
  "scheduler looks DOWN" alert in `/admin → Worker` after 15 min of silence.
- **Redundant driver:** `.github/workflows/notification-tick.yml` every 30 min
  with `CRON_FALLBACK_TOKEN` (dedupe keys make double-driving safe).
- **Self-heal:** the panel auto-re-registers the worker's
  `notifications-dispatch` schedule when it goes missing; per-device
  subscription self-heal already exists (`ensureSubscriptionSynced`), and the SW
  now handles `pushsubscriptionchange` (endpoint rotation) via
  `POST /api/notifications/push/rotate`.
- **Observability:** every push fan-out logs a `push_events` row
  (ok/partial/failed/no_subs/unconfigured + error codes), shown in the panel;
  per-device diagnosis via the existing "Send test" button.

## When to revisit

Native Android/iOS apps (FCM/APNs are then required for *native* push — the
`push_subscriptions.channel` column and the sender seam in `api/_lib/push.ts`
were designed for exactly that addition), or a hard requirement for
provider-side delivery analytics beyond `push_events`.
