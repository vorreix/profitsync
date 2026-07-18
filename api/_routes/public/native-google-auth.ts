import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClerkClient } from "@clerk/backend"

// The Google WEB OAuth client of Firebase project profitsync-app. Native Google
// Sign-In (Android/iOS) mints ID tokens with this `aud`. A public identifier,
// not a secret — but it IS the security boundary below: only tokens minted for
// our own OAuth client family are accepted, and each can only sign in as the
// token's own Google-verified email. Keep in sync with
// docs/native-oauth/GOOGLE_SIGNIN_SETUP.md.
const GOOGLE_WEB_CLIENT_ID =
  "622629171265-u02534555bnc0fpkp5hjk6dp3ei9a9jg.apps.googleusercontent.com"

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! })

type TokenInfo = {
  iss?: string
  aud?: string
  azp?: string
  email?: string
  email_verified?: string | boolean
  given_name?: string
  family_name?: string
}

// POST /api/public/native-google-auth  { token: <Google ID token> } → { ticket }
//
// Native Google Sign-In cannot use Clerk's `google_one_tap` strategy: tokens
// minted on-device carry the platform (Android/iOS) OAuth client in `azp`, and
// Clerk only authorizes tokens whose azp is the configured Web client → 403
// authorization_invalid (device-proven 2026-07-18; a garbage token errors
// differently, so the token itself verified fine). Instead the app exchanges
// the Google token here: WE verify it against Google, then mint a 60-second
// Clerk sign-in ticket the client redeems with an ordinary
// `signIn.create({ strategy: "ticket" })` write — which returns the rotated
// client token in the Authorization response header exactly like a password
// sign-in, so the native transport persists the session normally.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST")
    return res.status(405).json({ error: "Method not allowed" })
  }

  const token = typeof req.body?.token === "string" ? req.body.token : ""
  if (!token || token.length > 4096) {
    return res.status(400).json({ error: "Missing token" })
  }

  // Google validates the signature and expiry server-side; any invalid or
  // expired token comes back non-200.
  let info: TokenInfo
  try {
    const infoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`,
    )
    if (!infoRes.ok) return res.status(401).json({ error: "Invalid Google token" })
    info = (await infoRes.json()) as TokenInfo
  } catch {
    return res.status(502).json({ error: "Google verification unavailable" })
  }

  const issOk = info.iss === "https://accounts.google.com" || info.iss === "accounts.google.com"
  const emailVerified = info.email_verified === true || info.email_verified === "true"
  const email = (info.email ?? "").trim().toLowerCase()
  if (info.aud !== GOOGLE_WEB_CLIENT_ID || !issOk || !emailVerified || !email) {
    return res.status(401).json({ error: "Invalid Google token" })
  }

  try {
    const existing = await clerk.users.getUserList({ emailAddress: [email], limit: 1 })
    let userId = existing.data[0]?.id
    if (!userId) {
      const created = await clerk.users.createUser({
        emailAddress: [email],
        firstName: info.given_name || undefined,
        lastName: info.family_name || undefined,
        skipPasswordRequirement: true,
      })
      userId = created.id
    }

    const ticket = await clerk.signInTokens.createSignInToken({
      userId,
      expiresInSeconds: 60,
    })
    return res.status(200).json({ ticket: ticket.token })
  } catch (cause) {
    console.error("native-google-auth: Clerk exchange failed", cause)
    return res.status(502).json({ error: "Sign-in exchange failed" })
  }
}
