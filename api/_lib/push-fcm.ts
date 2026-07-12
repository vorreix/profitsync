// FCM HTTP v1 delivery — the native (Android now, iOS later) push channel.
//
// Mirrors the web-push sender's contract exactly: entirely best-effort and
// isolated. Without FCM_SERVICE_ACCOUNT_JSON every function no-ops, so the
// in-app path NEVER depends on it. No SDK dependency: the OAuth2 assertion is
// a hand-rolled RS256 JWT via node:crypto (Google's token endpoint + the FCM
// send endpoint are plain HTTPS), keeping cold starts light and the prod
// audit surface unchanged.
//
// Env: FCM_SERVICE_ACCOUNT_JSON — the Firebase service-account key, raw JSON
// or base64 of it (base64 survives Vercel env editing better).
//
// NOTE: relative imports MUST keep the `.js` extension — these modules run as
// unbundled ESM on @vercel/node (see scripts/check-esm-extensions.mjs).
import { createSign } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { pushSubscriptions } from "../../src/lib/db/schema.js"
import { logPushEvent, type PushPayload, type PushSendResult } from "./push.js"

export type FcmServiceAccount = {
  project_id: string
  client_email: string
  private_key: string
  token_uri?: string
}

const OAUTH_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token"

/** Parse the service-account env value (raw JSON or base64 JSON). Null when absent/invalid. */
export function parseFcmServiceAccount(raw: string | undefined | null): FcmServiceAccount | null {
  if (!raw) return null
  for (const candidate of [raw, tryBase64(raw)]) {
    if (!candidate) continue
    try {
      const parsed = JSON.parse(candidate) as Partial<FcmServiceAccount>
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          project_id: parsed.project_id,
          client_email: parsed.client_email,
          private_key: parsed.private_key,
          token_uri: parsed.token_uri,
        }
      }
    } catch {
      /* try the next decoding */
    }
  }
  return null
}

function tryBase64(raw: string): string | null {
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8")
    return decoded.trimStart().startsWith("{") ? decoded : null
  } catch {
    return null
  }
}

export function isFcmConfigured(): boolean {
  return parseFcmServiceAccount(process.env.FCM_SERVICE_ACCOUNT_JSON) !== null
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url")
}

/**
 * Build the signed OAuth2 JWT assertion for the service account. Exported for
 * the DB-free unit test (verified against a throwaway RSA keypair).
 */
export function buildFcmAssertion(sa: FcmServiceAccount, nowSeconds: number): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: OAUTH_SCOPE,
      aud: sa.token_uri || DEFAULT_TOKEN_URI,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  )
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.private_key)
  return `${header}.${claims}.${b64url(signature)}`
}

// Access-token cache: Google's tokens live ~1h; keyed by client_email so a
// rotated service account naturally invalidates it.
let tokenCache: { key: string; token: string; expiresAtMs: number } | null = null

async function getAccessToken(sa: FcmServiceAccount): Promise<string> {
  const now = Date.now()
  if (tokenCache && tokenCache.key === sa.client_email && tokenCache.expiresAtMs - 60_000 > now) {
    return tokenCache.token
  }
  const assertion = buildFcmAssertion(sa, Math.floor(now / 1000))
  const res = await fetch(sa.token_uri || DEFAULT_TOKEN_URI, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  })
  if (!res.ok) throw new Error(`oauth ${res.status}`)
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new Error("oauth no token")
  tokenCache = {
    key: sa.client_email,
    token: data.access_token,
    expiresAtMs: now + (data.expires_in ?? 3600) * 1000,
  }
  return data.access_token
}

/** FCM error statuses that mean the token is dead → prune the subscription row. */
const PRUNE_STATUSES = new Set(["UNREGISTERED", "INVALID_ARGUMENT"])

/**
 * Send a push to every fcm subscription (device token) a user has registered.
 * Dead tokens are pruned. Never throws — push is best-effort. `source` is
 * recorded in push_events prefixed `fcm:` so admins can tell channels apart.
 */
export async function sendFcmToUser(userId: string, payload: PushPayload, source = ""): Promise<PushSendResult> {
  const result = await doSendFcm(userId, payload)
  logPushEvent(userId, `fcm:${source}`, result)
  return result
}

async function doSendFcm(userId: string, payload: PushPayload): Promise<PushSendResult> {
  const result: PushSendResult = { configured: true, subscriptions: 0, ok: 0, failed: 0, pruned: 0, errors: [] }
  const sa = parseFcmServiceAccount(process.env.FCM_SERVICE_ACCOUNT_JSON)
  if (!sa) return { ...result, configured: false }

  let subs
  try {
    subs = await db
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.channel, "fcm")))
  } catch (err) {
    console.error("[fcm] failed to load subscriptions", { userId, err: String(err) })
    return { ...result, errors: ["load_failed"] }
  }
  result.subscriptions = subs.length
  if (subs.length === 0) return result

  let accessToken: string
  try {
    accessToken = await getAccessToken(sa)
  } catch (err) {
    console.error("[fcm] oauth failed", { err: String(err) })
    return { ...result, failed: subs.length, errors: [String((err as Error)?.message ?? err).slice(0, 60)] }
  }

  const sendUrl = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`
  await Promise.all(
    subs.map(async (s) => {
      try {
        const res = await fetch(sendUrl, {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify({
            message: {
              token: s.endpoint,
              notification: {
                title: payload.title,
                ...(payload.body ? { body: payload.body } : {}),
                ...(payload.image ? { image: payload.image } : {}),
              },
              // The app reads `url` on notification tap to deep-link.
              data: { url: payload.url ?? "/" },
              ...(payload.tag ? { android: { notification: { tag: payload.tag } } } : {}),
            },
          }),
        })
        if (res.ok) {
          result.ok++
          return
        }
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: { status?: string; details?: Array<{ errorCode?: string }> }
        }
        const status = errBody.error?.status ?? String(res.status)
        const fcmCode = errBody.error?.details?.find((d) => d.errorCode)?.errorCode
        if (res.status === 404 || PRUNE_STATUSES.has(status) || PRUNE_STATUSES.has(fcmCode ?? "")) {
          result.pruned++
          result.failed++
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)).catch(() => {})
          return
        }
        result.failed++
        if (!result.errors.includes(status)) result.errors.push(status)
        console.error("[fcm] send error", { userId, status, httpStatus: res.status })
      } catch (err) {
        result.failed++
        const summary = String((err as Error)?.message ?? err).slice(0, 60)
        if (!result.errors.includes(summary)) result.errors.push(summary)
        console.error("[fcm] send error", { userId, err: summary })
      }
    }),
  )
  console.log("[fcm] delivered", { userId, subscriptions: subs.length, ok: result.ok, failed: result.failed, pruned: result.pruned })
  return result
}
