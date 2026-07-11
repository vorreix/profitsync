# Worker Architecture Decision — Temporal evaluation & deep dive

**Question (before deploying):** should ProfitSync's background-work layer use
**Temporal** (durable workflow engine), and is the lightweight Go worker we built
actually production-OK? Plus: how does the **admin panel** see what's going on?

**TL;DR:**
1. **Do NOT adopt Temporal now.** Self-hosting it on one VPS goes against
   Temporal's own guidance, the footprint/ops burden is large, and ~80% of our
   jobs are fire-and-forget — Temporal's durable-workflow value doesn't apply yet.
2. **Keep the lightweight Go + Postgres worker** (matches the stated goal:
   separate server, docker-compose, own DB, no Redis, isolated). It's the right
   tool for this stage.
3. **Hardened it** for production: a reaper for crash-orphaned jobs, real
   graceful-drain on shutdown, and an admin observability API.
4. **Revisit Temporal Cloud** (not self-hosted) later, once we hit the trigger
   conditions below.

---

## 1. What Temporal is (and isn't)

Temporal is a **durable execution** platform: you write *Workflows* (deterministic
orchestration) and *Activities* (side effects); Temporal persists every step, so a
crashed worker resumes exactly where it left off. It gives automatic retries,
timeouts, long-running (days/months) workflows, signals/queries, and **Temporal
Schedules** (a durable cron). It runs a **server cluster** (frontend/history/
matching/worker services) + a persistence DB + a Web UI (+ optionally
Elasticsearch), with your code running as SDK *workers* that poll task queues.

It is genuinely excellent for complex, multi-step, long-running, or fan-out
workflows that must survive crashes — e.g. a resumable CSV import, or a
rate-limited bulk-email fan-out to thousands of recipients with per-step retries.

## 2. Why NOT Temporal for ProfitSync now (evidence)

- **Self-hosting on a single VPS is against Temporal's own guidance.** Single-node
  Docker Compose is documented as "small-scale/development"; production wants a
  real cluster. Even though **Elasticsearch is no longer required** (v1.20+ added
  SQL/Postgres visibility), you still run the server + DB + UI competing with your
  app for RAM, plus cert rotation, IP/service discovery, backups, and version
  upgrades. Realistic guidance is ~4 GB RAM minimum for a stable stack.
- **Operational cost is the real price.** The license is free, but self-hosting
  Temporal at production reliability implies meaningful SRE time — a poor trade for
  a small team. Temporal Cloud (managed) starts at **$100/mo (1M actions)** and
  removes the ops burden, but it's premature spend + lock-in, and you'd *still* run
  a separate worker.
- **It's the wrong shape for ~80% of our jobs.** Scheduled notifications, single
  transactional emails, one-off PDF generation, monthly analysis — these are
  "run a job, retry on failure." A Postgres queue covers them with none of
  Temporal's determinism/versioning constraints or the 2–4 week learning curve.
- **No incremental adoption.** Temporal is largely all-or-nothing — you rewrite
  jobs into workflows. A simple queue lets us adopt gradually and migrate later.

**Adopt Temporal (Cloud) when we hit ≥3 of:** genuinely multi-step orchestrations
that must resume mid-way; human-in-the-loop (approvals/signals); fan-out at scale
needing sophisticated rate limiting; ~10M+ actions/month; or a dedicated infra
person. Until then it's over-engineering. *(The closest current candidate is a
big resumable CSV import; a `jobs` row + checkpointing handles the first version.)*

Sources: Temporal self-hosted guide & visibility docs, Temporal Cloud pricing
(2026), `temporalio/docker-compose`, multiple 2026 teardown/comparison posts, and
a real-world team (ToolJet) that migrated *off* Temporal to a simpler queue.

## 3. The chosen architecture (and why it fits)

A **single Go binary** = durable **Postgres-backed queue** (`FOR UPDATE SKIP
LOCKED`) + **cron scheduler** + **HTTP control API**, deployed via docker-compose
with its **own Postgres** on a separate host. It matches every stated requirement:
self-hosted, lightweight (<100 MB worker), data-isolated from the app DB, no Redis,
and room to grow. App-specific logic stays in ProfitSync (trigger-style
`app.trigger` callback); heavy compute (PDF/CSV) runs in the worker → S3.

We considered alternatives: **River** (Go/Postgres, has a UI — strong, but we want
to keep one small surface for now), **asynq/BullMQ** (need Redis — rejected,
defeats database-only simplicity), **pg-boss** (Node — would run *inside* the
Vercel app, not the separate isolated server you asked for). The custom Go queue
is the best fit for the explicit "separate server + docker-compose + Go" goal; if
its observability/feature surface ever feels thin, **River** is the natural
in-place upgrade (still Go + Postgres).

## 4. Production review of the worker — fixed before deploy

Adversarial review found three real gaps; all are now fixed + verified end-to-end
with Docker:

| Issue | Severity | Fix |
|---|---|---|
| **Orphaned `running` jobs** — a worker crashing mid-job left the row `running` forever (lost work). | High | A **reaper** (in the scheduler tick) requeues jobs stuck in `running` past `WORKER_VISIBILITY_TIMEOUT`; past `max_attempts` → dead-letter. *Verified: an injected orphaned job was reaped → requeued → completed.* |
| **Shutdown didn't drain** — `main()` returned on SIGTERM without waiting for in-flight jobs. | Medium | `main()` now waits for the worker pool to drain (bounded by `WORKER_SHUTDOWN_GRACE`). *Verified: SIGTERM → "draining" → "worker pool drained" → "clean shutdown".* |
| **No admin visibility** | Medium (the ask) | Added `/v1/stats`, `/v1/jobs`, `/v1/jobs/{id}/retry|cancel` (see §5). |

Also confirmed OK: dequeue is race-safe (`SKIP LOCKED`); dedupe uses a pre-check +
partial-unique backstop; retries are exponential-backoff; HTTP auth is
constant-time bearer; migrations are idempotent. Follow-up (not a blocker): commit
`go.sum` for fully reproducible builds (the Dockerfile currently runs `go mod tidy`).

## 5. Admin observability — "see what's going on"

The worker exposes a bearer-authed observability API (`/v1/stats`, `/v1/jobs`,
retry/cancel). ProfitSync's **/admin** gets a **Worker** panel via a *server-side
proxy* (`/api/admin/worker/*`, super-admin-gated) that holds the worker token —
**the token never reaches the browser**, and the worker needn't be publicly
exposed beyond ProfitSync's egress. The panel shows: counts by status
(queued/running/done/failed/dead), recent jobs with last error, and retry/cancel
actions. This gives the same essential operator view Temporal's Web UI would —
without standing up Temporal — and is the recommended approach at this stage.

(If we later move to Temporal Cloud, its Web UI replaces this panel for deep
workflow history; we'd link out to it from /admin.)

## 6. Migration path

1. **Now:** ship the hardened Go queue; wire reminders + (later) admin broadcasts
   through it; add the /admin Worker panel.
2. **If the queue's feature surface gets thin:** swap the engine for **River**
   (in place, still Go + Postgres) — gets a richer UI + batching.
3. **If we hit the Temporal trigger conditions (§2):** adopt **Temporal Cloud**
   (managed, not self-hosted) and move the complex/resumable workflows there,
   keeping simple jobs on the queue.

This keeps us simple and cheap now, with a clear, low-regret upgrade ladder.
