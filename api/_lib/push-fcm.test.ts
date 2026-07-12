import { generateKeyPairSync, createVerify } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { buildFcmAssertion, parseFcmServiceAccount, sendFcmToUser } from "./push-fcm.js"

// DB-free: the sender is only exercised on its unconfigured path (returns
// before any query), and the JWT is verified against a throwaway RSA keypair.

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
})

const SA = {
  project_id: "test-project",
  client_email: "svc@test-project.iam.gserviceaccount.com",
  private_key: privateKey,
}

describe("parseFcmServiceAccount", () => {
  it("accepts raw JSON", () => {
    const parsed = parseFcmServiceAccount(JSON.stringify(SA))
    expect(parsed?.project_id).toBe("test-project")
    expect(parsed?.client_email).toBe(SA.client_email)
  })

  it("accepts base64-encoded JSON", () => {
    const parsed = parseFcmServiceAccount(Buffer.from(JSON.stringify(SA)).toString("base64"))
    expect(parsed?.project_id).toBe("test-project")
  })

  it("rejects garbage, empties, and incomplete accounts", () => {
    expect(parseFcmServiceAccount(undefined)).toBeNull()
    expect(parseFcmServiceAccount("")).toBeNull()
    expect(parseFcmServiceAccount("not json")).toBeNull()
    expect(parseFcmServiceAccount(JSON.stringify({ project_id: "x" }))).toBeNull()
  })
})

describe("buildFcmAssertion", () => {
  it("produces a valid RS256 JWT with the right claims", () => {
    const now = 1_750_000_000
    const jwt = buildFcmAssertion(SA, now)
    const [h, c, s] = jwt.split(".")
    expect(h && c && s).toBeTruthy()

    const header = JSON.parse(Buffer.from(h, "base64url").toString())
    expect(header).toEqual({ alg: "RS256", typ: "JWT" })

    const claims = JSON.parse(Buffer.from(c, "base64url").toString())
    expect(claims.iss).toBe(SA.client_email)
    expect(claims.scope).toBe("https://www.googleapis.com/auth/firebase.messaging")
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token")
    expect(claims.iat).toBe(now)
    expect(claims.exp).toBe(now + 3600)

    const ok = createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s, "base64url"))
    expect(ok).toBe(true)
  })

  it("honours a custom token_uri as the audience", () => {
    const jwt = buildFcmAssertion({ ...SA, token_uri: "https://example.test/token" }, 1)
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString())
    expect(claims.aud).toBe("https://example.test/token")
  })
})

describe("sendFcmToUser", () => {
  const saved = process.env.FCM_SERVICE_ACCOUNT_JSON
  afterEach(() => {
    if (saved === undefined) delete process.env.FCM_SERVICE_ACCOUNT_JSON
    else process.env.FCM_SERVICE_ACCOUNT_JSON = saved
  })

  it("no-ops (configured:false) without the service-account env", async () => {
    delete process.env.FCM_SERVICE_ACCOUNT_JSON
    const result = await sendFcmToUser("user_x", { title: "t" }, "test")
    expect(result.configured).toBe(false)
    expect(result.ok).toBe(0)
    expect(result.subscriptions).toBe(0)
  })
})
