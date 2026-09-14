---
name: data-fetching-and-cache
description: Use when fetching data on the client, adding or changing an API route, adding an apiGet/apiPost/apiPatch/apiPut/apiDelete call, writing a screen that loads data, making a page feel faster or removing a loading spinner/skeleton, or touching src/lib/api.ts, src/lib/api-cache.ts, useApiQuery, cache invalidation, stale data after a save, or scripts/check-cache-map.mjs. Establishes the warm-shell/live-money model — how long a read may be reused, what may reach disk, which reads a write invalidates, and the GET routes that move money while they serve.
---

# ProfitSync data fetching & cache

**The rule this whole system exists for: a screen the user has already seen must never
show a skeleton again, and a number on it must never be wrong.** Those pull in opposite
directions, and everything below is how the tension is resolved. Don't resolve it again
per-screen.

Two files own it:

| File | Owns |
|---|---|
| `src/lib/api-cache.ts` | **Policy.** Pure tables: how long each path may be reused, what may reach disk, what each write invalidates. No browser APIs, no React. |
| `src/hooks/use-api-query.ts` | The read hook new screens should use. `src/components/alerts/AlertsBanner.tsx` is the reference adoption. |
| `src/lib/api.ts` | **Mechanism.** The two-tier store under `apiGet`/`apiPost`/…, applying those tables. |

`scripts/check-cache-map.mjs` (in the pre-commit gate and `pr.yml`, `npm run cache:check`)
fails the build when the tables stop matching the code.

## The model

- **The shell is warm; the money is live.** The organization list and config
  (`/api/organizations`, `/api/categories`, `/api/tags`) persist to `localStorage`, so a
  cold start has part of the app frame in hand before the first request. Everything else
  is memory-only and dies with the tab.
- **Two things disqualify a body from disk**, and the second is the one that bites:
  it carries a balance, **or it decides what the user sees**. `/api/profile` looks like
  the safest thing in the app and is not — it carries `current_organization_id`, the
  active workspace. Off disk it puts you back in the workspace you left on another
  device, and a personal-only route (`/budgets`) redirects you away *before* the fresh
  copy lands, so the correction never gets to show. `/api/admin/me` gates a whole console
  and is out for the same reason. Both still get the long **in-memory** window, which is
  where most of the win is.
- **Stale-while-revalidate, announced.** Past its freshness window a body is still painted,
  and a refresh runs behind the paint. If the fresh copy *differs*, the store emits the
  same `DATA_CHANGED_EVENT` a mutation does — which is why ~235 existing `apiGet` call
  sites inherited all of this without being edited: they already refetch on that event, and
  the refetch lands on the now-fresh cache, costing a render and no request.
- **Nine GET routes write money while they serve.** `/api/transactions`,
  `/api/wealth/accounts`, `/api/spaces`, `/api/cards`, `/api/recurring`, `/api/calendar`,
  `/api/flow` (and the nested `cards/:id/summary`, `spaces/:id/auto-save`) materialise due
  recurring transactions, file credit-card statements and run autopay. They may **paint**
  from cache; the request must still go out. That is `ALWAYS_FETCH`, and it is enforced by
  the guard script, not by anyone remembering.
- **One table decides invalidation.** `invalidationFor(path)` in `api-cache.ts`. There is
  deliberately **no per-call-site override** — there used to be, and all 28 sites that
  passed one were narrower than the truth.

## Doing the common things

**Reading data on a screen.** Prefer `useApiQuery` (`src/hooks/use-api-query.ts`):

```ts
const { data, loading, refreshing, error, refetch } = useApiQuery<Card[]>("/api/cards")
```

`loading` is true **only when there is nothing to draw** — gate skeletons on that, never on
`refreshing`. Rendering a skeleton over data you already have is the exact regression this
system removes. Pass `null` as the path to stand down without breaking the rules of hooks.
The existing `apiGet` + `useEffect` + `useState` pattern still works and is still cached;
`useApiQuery` additionally picks up background revalidations.

**Writing data.** Just call it — the fanout table handles the rest:

```ts
await apiPost("/api/transactions", token, body)   // no invalidate argument exists
```

**Adding an API route.** Add its write path to `FANOUT` in `api-cache.ts` with the read
prefixes it *actually* makes wrong, and its read path to a freshness class. An unmapped
write path still behaves correctly — it purges everything — but that throws away every
screen's data, so `check-cache-map.mjs` fails the build until you map it.

**Writing with a raw `fetch`** (attachments do this, for the base64 body): nothing
invalidates for you. Call `invalidateKeys([...])` yourself — see
`invalidateAttachmentCache()` in `src/lib/attachments-client.ts`.

## Invariants — do not break these

1. **Nothing that carries a balance — or picks the workspace — reaches disk.**
   `PERSIST_ALLOWLIST` is default-deny. Before adding to it, ask both questions: is there a
   number in this body, and does anything route, redirect or gate on it?
2. **A GET that materialises money is in `ALWAYS_FETCH`.** Skipping its request doesn't
   fail — it silently doesn't run someone's autopay.
3. **A write invalidates what it changed, not what it looks like it changed.** Two that
   read as config and are not: a **category rename** rewrites `category` on transactions,
   clients *and* quotations and moves budget spend between envelopes; a **plan or org
   change** invalidates every quota-gated read. Both are in the table — check yours is.
4. **The cache key carries the user** (`sub|org|path`). Never key by org alone: two people
   share a browser, and the only thing between them would be a timer.
5. **Never cache a one-shot or metered response.** Presigned URLs, AI answers, OTP
   endpoints. Match them *narrowly* — `/api/ai/` as a prefix also catches `/api/ai/quota`,
   an ordinary balance read that four components ask for on one page load.
6. **`clearApiCache()` clears disk too.** `lookup()` rehydrates from storage on a memory
   miss, so a memory-only clear hands the next reader the body it was told to forget.
7. **A background refresh never surfaces an error.** The caller already has a usable answer;
   a failed revalidation keeps the painted body and backs off.
8. **A write made with a raw `fetch` invalidates nothing on its own.** Two places do this —
   attachments, and any test helper driving the API from `page.evaluate`. The first calls
   `invalidateAttachmentCache()`; the second is why an e2e that switches workspace by raw
   fetch has to reload.

## Verifying a change

- `npm run cache:check` — the map still matches the code.
- `npx vitest run src/lib/api-cache.test.ts src/lib/api-store.test.ts` — policy tables and
  store behaviour (SWR, identity keying, persistence, invalidation, the in-flight
  generation guard).
- **Count the requests in a real browser** — this is the check that catches the regressions
  the unit tests can't. Attach `page.on("request", …)`, filter `/api/`, and navigate. The
  bar to hold: a **client-side navigation to a screen already visited fires 0 requests**;
  a hard reload fetches no `/api/profile` or `/api/organizations`. Anything ≥ 1 on a warm
  SPA navigation means something is purging the cache mid-load — find the write that did it
  and give it a narrower fanout rule.
