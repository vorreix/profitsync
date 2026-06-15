import { describe, it, expect } from "vitest"
import {
  categoryForType,
  defaultChannelEnabled,
  fullDefaultPreferences,
  resolveChannelEnabled,
  resolveAnyChannel,
  sanitizePreferences,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationPreferences,
} from "./notifications"

describe("categoryForType", () => {
  it("maps known types to their category and falls back to system", () => {
    expect(categoryForType("member_invited")).toBe("team")
    expect(categoryForType("payment_failed")).toBe("billing")
    expect(categoryForType("budget_exceeded")).toBe("budget")
    expect(categoryForType("totally_unknown_type")).toBe("system")
  })
})

describe("defaultChannelEnabled", () => {
  it("always shows in_app and pushes only high-signal categories", () => {
    for (const c of NOTIFICATION_CATEGORIES) expect(defaultChannelEnabled(c, "in_app")).toBe(true)
    expect(defaultChannelEnabled("team", "web_push")).toBe(true)
    expect(defaultChannelEnabled("billing", "web_push")).toBe(true)
    expect(defaultChannelEnabled("budget", "web_push")).toBe(true)
    expect(defaultChannelEnabled("transactions", "web_push")).toBe(false)
    expect(defaultChannelEnabled("clients", "web_push")).toBe(false)
    expect(defaultChannelEnabled("system", "web_push")).toBe(false)
  })
})

describe("fullDefaultPreferences", () => {
  it("populates every category × channel and is not muted", () => {
    const p = fullDefaultPreferences()
    expect(p.muted).toBe(false)
    for (const c of NOTIFICATION_CATEGORIES) {
      for (const ch of NOTIFICATION_CHANNELS) {
        expect(p.categories[c][ch]).toBe(defaultChannelEnabled(c, ch))
      }
    }
  })
})

describe("resolveChannelEnabled — cascade", () => {
  it("uses system defaults when the cascade is empty/sparse", () => {
    expect(resolveChannelEnabled([], "team", "in_app")).toBe(true)
    expect(resolveChannelEnabled([null, undefined], "transactions", "web_push")).toBe(false)
    expect(resolveChannelEnabled([{}], "team", "web_push")).toBe(true)
  })

  it("most-specific explicit value wins over outer levels and defaults", () => {
    const user: NotificationPreferences = { categories: { transactions: { web_push: true } } }
    // user enabled push for transactions (default off) → delivered
    expect(resolveChannelEnabled([user], "transactions", "web_push")).toBe(true)
    // client level (most specific) turns it back off, overriding the user level
    const client: NotificationPreferences = { categories: { transactions: { web_push: false } } }
    expect(resolveChannelEnabled([client, user], "transactions", "web_push")).toBe(false)
  })

  it("falls through a level that has no opinion to the next level", () => {
    const org: NotificationPreferences = { categories: { billing: { in_app: false } } }
    const user: NotificationPreferences = { categories: { billing: { in_app: true } } }
    // client has no opinion → org wins
    expect(resolveChannelEnabled([null, org, user], "billing", "in_app")).toBe(false)
    // remove org's opinion → user wins
    expect(resolveChannelEnabled([null, {}, user], "billing", "in_app")).toBe(true)
  })

  it("muted at ANY level blocks delivery on every channel", () => {
    const mutedUser: NotificationPreferences = { muted: true }
    expect(resolveChannelEnabled([mutedUser], "team", "in_app")).toBe(false)
    // even if a more-specific level explicitly enables the channel, an outer mute wins
    const client: NotificationPreferences = { categories: { team: { in_app: true } } }
    expect(resolveChannelEnabled([client, mutedUser], "team", "in_app")).toBe(false)
    // a muted client mutes even when the user is not muted
    expect(resolveChannelEnabled([{ muted: true }, {}], "billing", "in_app")).toBe(false)
  })

  it("defaultOverride flips the fallback ON (broadcasts/reminders) but mute + explicit opt-out still win", () => {
    // system web_push defaults OFF — without an override a broadcast wouldn't push.
    expect(resolveChannelEnabled([], "system", "web_push")).toBe(false)
    // defaultOverride=true pushes by default when there's no explicit opinion.
    expect(resolveChannelEnabled([{}], "system", "web_push", true)).toBe(true)
    // an explicit user opt-out still wins over the override.
    const optedOut: NotificationPreferences = { categories: { system: { web_push: false } } }
    expect(resolveChannelEnabled([optedOut], "system", "web_push", true)).toBe(false)
    // mute still wins over the override.
    expect(resolveChannelEnabled([{ muted: true }], "system", "web_push", true)).toBe(false)
  })
})

describe("resolveAnyChannel", () => {
  it("is true when at least one channel resolves on", () => {
    expect(resolveAnyChannel([], "team")).toBe(true) // in_app default
    expect(resolveAnyChannel([{ muted: true }], "team")).toBe(false)
    const onlyPushOff: NotificationPreferences = { categories: { team: { web_push: false } } }
    expect(resolveAnyChannel([onlyPushOff], "team")).toBe(true) // in_app still on
  })
})

describe("sanitizePreferences", () => {
  it("keeps known fields and drops unknown categories/channels and junk", () => {
    const dirty = {
      muted: true,
      categories: {
        team: { in_app: true, web_push: false, email: true, junk: "x" },
        evil_category: { in_app: true },
      },
      extra: "ignored",
    }
    const clean = sanitizePreferences(dirty)
    expect(clean.muted).toBe(true)
    expect(clean.categories?.team).toEqual({ in_app: true, web_push: false })
    expect(clean.categories).not.toHaveProperty("evil_category")
    // unknown channel "email" is not in NOTIFICATION_CHANNELS yet → dropped
    expect((clean.categories?.team as Record<string, unknown>).email).toBeUndefined()
  })

  it("returns an empty object for non-object input", () => {
    expect(sanitizePreferences(null)).toEqual({})
    expect(sanitizePreferences("nope")).toEqual({})
    expect(sanitizePreferences(42)).toEqual({})
  })

  it("omits categories entirely when nothing valid is present", () => {
    expect(sanitizePreferences({ categories: { junk: {} } })).toEqual({})
  })
})
