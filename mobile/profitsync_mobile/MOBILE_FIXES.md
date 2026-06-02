# ProfitSync Mobile — Fixes & Improvements

Tracking the round of fixes requested after on-device (iOS) testing. Checked items
are done & verified (`flutter analyze` clean + exercised).

## Reported issues

- [x] 1. Dark/light theme switcher — `ThemeController` (System/Light/Dark) persisted in SharedPreferences, provided above `MaterialApp`; selector in Profile › Appearance. Verified dark renders on device.
- [x] 2. Org switch auto-reload — `HomeShell` body is keyed on the active org id, so the visible tab re-mounts and reloads after a switch.
- [x] 3. Payment no longer hangs — `SubscriptionScreen` is a `WidgetsBindingObserver`; on app-resume after checkout it auto-runs `/api/billing/sync` (polls up to 5×) and shows an "Awaiting payment / Check payment status" card.
- [x] 4. Payment completion like web — sync reconciles status; `active`/`trialing` ⇒ `refresh()` org + reload pricing; stub mode still activates instantly.
- [x] 5. Create organization — "Create workspace" in the org switcher → `POST /api/organizations {name}` → refresh + switch into the new workspace.
- [x] 6. Current plan shown — Profile plan tile shows the plan name (`planDisplayName`) + badge; subscription "current plan" card shows the resolved name.
- [x] 7. Overflow fixes — current-plan card (name `Flexible`+ellipsis), plan card name/strikethrough wrapped; income/expense toggle uses `FittedBox`; audited list/profile/org rows.
- [x] 8. Currency changeable — Profile currency tile opens a searchable 155-currency picker → `PATCH /api/organizations/:id {currency}` → refresh (owner/admin only).
- [x] 9. Removed "Refresh data" button — lists auto-refresh on mount, org switch, pull-to-refresh, and after mutations.
- [x] 10. Client status chips — clearly styled (filled when selected, bordered otherwise); create form offers Active/Inactive only (web parity); Archived shown only when editing an already-archived client.
- [x] 11. Client cards update — client detail reloads client + transactions after add/edit; list/dashboard re-mount on tab switch.
- [x] 12. Filters & sorting — Transactions: type + date-range (all/month/30d/year) + sort (date/amount); Clients: status filter + sort (name/net); Quotations: status filter + sort (amount/title).
- [x] 13. Toggle alignment — income/expense segments use constant border width + `FittedBox`, so the icon+label stay centered and don't shift when selected.
- [x] 14. Quotation UX — tapping a quote opens a detail/actions sheet: inline status change (`PATCH`), Convert to client (`POST …/convert`), Edit, Delete, with a "Converted" indicator.
- [x] 15. Transaction attachments — pick/add/remove with on-device limits (free 1 MB ×1, premium 10 MB ×10), type allow-list (pdf/images/docs/sheets); existing-txn uploads immediately, new-txn uploads after create; delete via `/api/attachments/:id`.

## Backend reference (web parity)

- Create org: `POST /api/organizations {name}` → new non-personal org (currency defaults to profile). Switch after create.
- Currency: per-org. `PATCH /api/organizations/:id {currency}` (owner/admin). Personal org currency *can* change; only name is locked.
- Client create status options on web: `active`, `inactive` only.
- Payment: `POST /api/billing/create-subscription {plan_key,cycle}` → `{checkout_url}` (hosted) or stub `{message}`. On return call `POST /api/billing/sync` → `{subscription:{status}}`; `active` ⇒ refresh org.
- Attachments: `POST /api/transactions/:id/attachments {file_name,file_type,file_size,file_data(base64)}`; list via GET; delete via `DELETE /api/attachments/:id`. 402 with `{reason}` when over quota.
- Convert: `POST /api/quotations/:id/convert` (no body) → creates client, sets quote `accepted` + `linked_client_id`.

## Extra bugs / improvements found while fixing

- google_fonts still in pubspec but unused (caused the earlier Android black-screen) — remove to prevent regressions.
- API GET cache TTL is 20s; org switch clears it, but list screens hold a fixed `_future` → stale until re-mount. Fixed by keying the shell body on active org id.
- Quotation list had no way to act on a quote except opening the edit sheet — added a detail/actions sheet.
- Currency `formatMoney`/`currencySymbol` only knew ~11 symbols — now backed by the full 155-currency list.
</content>
</invoke>
