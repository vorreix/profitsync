# ProfitSync Worker — Deployment & Operations Runbook

Step-by-step to deploy the background worker (`worker/`) on a dedicated host, wire
it to the ProfitSync app, and operate it. For *what it is and why* read
`worker/README.md`; for *why not Temporal* read `docs/worker/ARCHITECTURE_DECISION.md`.

> **Mental model:** the worker is a separate, isolated service. It has its **own
> Postgres** (just the job queue) and **never touches the app DB**. The app and
> the worker talk over HTTP, authenticated by two shared secrets (below).

---

## 0. The two tokens (don't mix them up)

| Token | Direction | Set on |
|---|---|---|
| `WORKER_API_TOKEN` | **app → worker** (the bearer the worker checks on `/v1/*`) | worker `.env` **and** Vercel — *same value* |
| `PROFITSYNC_SERVICE_TOKEN` | **worker → app** (the bearer the app checks on `/api/internal/*`) | worker `.env` **and** Vercel — *same value* |

Generate each (run twice, once per token):
```bash
openssl rand -hex 32
```
Keep them secret, never commit, and always reach the worker over **HTTPS** (the
token is a bearer header — plain HTTP would leak it).

---

## 1. Provision the host

- A small VPS is plenty — **Hetzner CX22 (2 vCPU / 4 GB)** or similar. (4 GB gives
  comfortable headroom for the worker + its Postgres; the worker binary itself is
  tiny.)
- Install Docker Engine + the compose plugin:
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```
- Open only what you need (see §7 Security). The worker's HTTP port should not be
  open to the world — front it with TLS and restrict ingress.

## 2. Get the code on the host

Clone the repo (the worker is the `worker/` folder) — or copy just that folder:
```bash
git clone <your-repo> profitsync && cd profitsync/worker/deploy
```

## 3. Configure `worker/deploy/.env`

```bash
cp .env.example .env
```
Fill in:
```bash
WORKER_API_TOKEN=<openssl rand -hex 32>        # app → worker
POSTGRES_PASSWORD=<openssl rand -hex 24>        # the bundled queue DB
PROFITSYNC_BASE_URL=https://profitsync.net
PROFITSYNC_SERVICE_TOKEN=<openssl rand -hex 32> # worker → app
# Optional S3 (PDF/CSV artifacts):
S3_ENDPOINT=...   S3_BUCKET=...   S3_ACCESS_KEY=...   S3_SECRET_KEY=...
```
Leave `DATABASE_URL` unset — compose builds it from `POSTGRES_PASSWORD` and points
the worker at its own `postgres` service.

## 4. Start it

```bash
docker compose up -d --build
docker compose ps                       # worker + postgres healthy
curl localhost:8080/healthz             # {"status":"ok"}
```
On first boot the worker runs its migrations (jobs + schedules tables) and starts
the worker pool, scheduler, and HTTP API.

## 5. Put it behind TLS — host nginx + certbot

The worker stays private on `127.0.0.1:${WORKER_PORT}` (default `8656`); a **host
nginx** terminates HTTPS for `worker.profitsync.net` and reverse-proxies to it.
certbot runs on the host (its DNS works), so there's no container-DNS dependency for
the cert.

1. **DNS:** an A/AAAA record for `worker.profitsync.net` → this host. Open inbound
   **80 + 443** (cloud security group / firewall).
2. **Install nginx + certbot** (if not present): `sudo apt install -y nginx certbot
   python3-certbot-nginx` and `sudo systemctl enable --now nginx`.
3. **Add the vhost** — copy the template and enable it:
   ```bash
   sudo cp worker/deploy/nginx-worker.conf.example /etc/nginx/sites-available/worker.profitsync.net
   sudo ln -s /etc/nginx/sites-available/worker.profitsync.net /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```
4. **Issue the cert + redirect:** `sudo certbot --nginx -d worker.profitsync.net`
   (auto-adds the 443 block + HTTP→HTTPS; auto-renews via the certbot timer).
5. **Verify:** `curl https://worker.profitsync.net/healthz` → `{"status":"ok"}`.

Your `WORKER_BASE_URL` is then `https://worker.profitsync.net`. nginx reaches the
worker at `127.0.0.1:8656`, so keep `WORKER_BIND=127.0.0.1` and **firewall the public
`8656`** — the worker should only be reachable via HTTPS.

## 6. Connect the app (Vercel)

Set the app-side env and redeploy:
```bash
vercel env add WORKER_BASE_URL production            # https://worker.profitsync.net
vercel env add WORKER_API_TOKEN production            # SAME as the worker's
vercel env add PROFITSYNC_SERVICE_TOKEN production     # SAME as the worker's
```
After redeploy, **/admin → Worker** flips from "not configured" to live queue
stats. Smoke-test the link both ways:
```bash
# app → worker (from your laptop, with the worker token):
curl https://worker.profitsync.net/v1/stats -H "Authorization: Bearer $WORKER_API_TOKEN"
```

## 7. Register schedules

The worker is the clock. Register a schedule once (e.g. dispatch due notifications
every 5 min — drives reminders/broadcasts):
```bash
curl -X POST https://worker.profitsync.net/v1/schedules \
  -H "Authorization: Bearer $WORKER_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{ "name":"notifications-dispatch", "type":"app.trigger", "cron":"*/5 * * * *",
        "timezone":"UTC", "payload":{ "path":"/api/internal/cron/notifications" } }'
```
When it fires, the worker POSTs to `PROFITSYNC_BASE_URL/api/internal/cron/notifications`
with the service token; the app runs the logic. (Those internal endpoints are
added with the reminder/broadcast features — see `docs/notifications/V2_ROADMAP.md`.)

---

## 8. Observability

- **/admin → Worker** (in the app): status counts (queued/running/done/failed/dead/
  cancelled), recent jobs with last error, and retry/cancel. Backed by a
  super-admin server-side proxy that holds the worker token.
- **Logs (stdout):** `docker compose logs -f worker` — structured JSON for every
  HTTP request (method/path/status/duration), job start/done/failed, app callbacks
  (status + duration), schedule fires, reaped orphans, and shutdown. Set
  `WORKER_LOG_LEVEL=debug` to also see each scheduler tick + job claim.
- **Logs (file + rotation):** with `WORKER_LOG_DIR=/app/logs` (set by compose, on
  the `worker_logs` volume) the same logs are written to `/app/logs/worker.log`,
  size-rotated by lumberjack (`WORKER_LOG_MAX_SIZE_MB`/`MAX_BACKUPS`/`MAX_AGE_DAYS`/
  `COMPRESS`). Tail it: `docker compose exec worker tail -f /app/logs/worker.log`;
  copy out: `docker compose cp worker:/app/logs ./worker-logs`.
- **Direct API:** `GET /v1/stats`, `GET /v1/jobs?status=failed`.

## 9. Operations

| Task | Command |
|---|---|
| Tail logs | `docker compose logs -f worker` |
| Restart | `docker compose restart worker` |
| Update to new code | `git pull && docker compose up -d --build` |
| Stop (graceful) | `docker compose stop worker` (drains in-flight jobs, ≤ `WORKER_SHUTDOWN_GRACE`) |
| Backup the queue DB | `docker compose exec -T postgres pg_dump -U worker worker > worker-$(date +%F).sql` |
| Scale throughput | raise `WORKER_CONCURRENCY` in `.env` + restart |
| Scale out (HA) | run a 2nd worker container against the same DB — `SKIP LOCKED` makes concurrent workers safe |

**Reliability built in:** a crashed worker's in-flight jobs are rescued — the
scheduler reaps rows stuck in `running` past `WORKER_VISIBILITY_TIMEOUT` and
requeues them (dead-letters past `max_attempts`). Set `WORKER_VISIBILITY_TIMEOUT`
comfortably **above** `WORKER_JOB_TIMEOUT`.

## 10. Security checklist

**Ports (what's exposed where):**

| Service | Host exposure | Notes |
|---|---|---|
| host **nginx** | **80 + 443 public** | The HTTPS front door (TLS via certbot). Keep 80 (below). |
| `worker` (container) | **`127.0.0.1:8656` only** (default `WORKER_BIND`) | NOT internet-facing; nginx proxies to it on localhost. |
| `postgres` (container) | **none** (compose network only) | Never published to the host. |

- [ ] Worker reached over **HTTPS** only (host nginx); the worker port binds to
      `127.0.0.1` (`WORKER_BIND` default) — don't set it to `0.0.0.0`.
- [ ] `WORKER_API_TOKEN` + `PROFITSYNC_SERVICE_TOKEN` are long random secrets (`openssl
      rand -hex 32`), identical on the worker and Vercel, never committed.
- [ ] **Firewall:** allow only `22` (SSH), `80`, `443`; deny the rest. Even though the
      worker binds to localhost, explicitly blocking `8656` is good defense-in-depth.
      ```bash
      # ufw (install with `sudo apt install ufw` if missing):
      sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw deny 8656 && sudo ufw enable
      # No ufw? Use the cloud provider's security group to allow only 22/80/443 inbound.
      ```
- [ ] The worker DB (`postgres`) is **not** published to the host (it isn't, by default).
- [ ] `.env` is `chmod 600` and gitignored.
- [ ] Only `/healthz` is unauthenticated (harmless `{"status":"ok"}`); every `/v1/*`
      route is bearer-authed with a constant-time compare.

**Do you need port 80?** Keep it. nginx uses `:80` for (1) the HTTP→HTTPS redirect
certbot adds, and (2) the Let's Encrypt **HTTP-01** challenge (cert issuance + renewal).
Port 80 then serves *only* a redirect + the ACME challenge path, so it's not a
meaningful attack surface. (Optional extra hardening in the nginx vhost:
`limit_req` rate limiting + security headers; the worker's bearer auth + bounded
pool already bound abuse.)

## 11. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| /admin Worker shows **"not configured"** | `WORKER_BASE_URL` / `WORKER_API_TOKEN` not set in Vercel (or not redeployed). |
| /admin Worker shows **"unreachable"** | Worker down, wrong URL, TLS/cert issue, or firewall blocking Vercel. Check `docker compose ps` + `curl .../healthz`. |
| `401` from `/v1/*` | `WORKER_API_TOKEN` mismatch between app and worker. |
| Jobs pile up in **queued** | Worker pool not running / crashed — check logs; raise `WORKER_CONCURRENCY`. |
| Jobs stuck in **running** | A worker died mid-job; the reaper requeues them after `WORKER_VISIBILITY_TIMEOUT`. |
| Job in **dead** | Exceeded `max_attempts` — inspect `last_error` in /admin, fix the cause, **Retry**. |
| Schedule never fires | Check the cron expression + `timezone`; a brand-new schedule is initialised on the first tick (it fires on the *next* matching time, not immediately). |
| Build fails on the host | Ensure Docker has network for the Go module download; commit `go.sum` for fully reproducible builds. |
