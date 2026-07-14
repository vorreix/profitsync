import { describe, it, expect } from "vitest"
import {
  categoryForType,
  decideNoOrgSwitch,
  defaultChannelEnabled,
  fullDefaultPreferences,
  pushUrlWithOrg,
  resolveChannelEnabled,
  resolveAnyChannel,
  sanitizePreferences,
  notificationRenderKeys,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationKeyKind,
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

describe("notificationRenderKeys", () => {
  // Simulates the en resource tree: bare type keys are objects, their members
  // are strings — exactly the shape locale parity enforces.
  const tree: Record<string, NotificationKeyKind> = {
    "types.add_transaction_reminder": "object",
    "types.add_transaction_reminder.title": "string",
    "types.add_transaction_reminder.body": "string",
    "types.role_changed.title": "string",
    "types.role_changed.body": "string",
    "types.admin_broadcast": "object",
    "types.admin_broadcast.title": "string",
  }
  const kindOf = (key: string): NotificationKeyKind => tree[key] ?? "missing"

  it("rewrites a legacy bare type key to its .title/.body members", () => {
    expect(notificationRenderKeys({ i18nKey: "types.add_transaction_reminder" }, kindOf)).toEqual({
      titleKey: "types.add_transaction_reminder.title",
      bodyKey: "types.add_transaction_reminder.body",
    })
  })

  it("keeps well-formed .title keys and derives the sibling .body", () => {
    expect(notificationRenderKeys({ i18nKey: "types.role_changed.title" }, kindOf)).toEqual({
      titleKey: "types.role_changed.title",
      bodyKey: "types.role_changed.body",
    })
  })

  it("prefers an explicit i18nBodyKey over any derivation", () => {
    expect(
      notificationRenderKeys(
        { i18nKey: "types.add_transaction_reminder", i18nBodyKey: "types.role_changed.body" },
        kindOf,
      ),
    ).toEqual({
      titleKey: "types.add_transaction_reminder.title",
      bodyKey: "types.role_changed.body",
    })
  })

  it("never invents members that don't exist (object without .body)", () => {
    expect(notificationRenderKeys({ i18nKey: "types.admin_broadcast" }, kindOf)).toEqual({
      titleKey: "types.admin_broadcast.title",
      bodyKey: null,
    })
  })

  it("passes unknown keys through unchanged (defaultValue handles the fallback)", () => {
    expect(notificationRenderKeys({ i18nKey: "types.unknown.title" }, kindOf)).toEqual({
      titleKey: "types.unknown.title",
      bodyKey: null,
    })
  })

  it("handles empty/missing data", () => {
    expect(notificationRenderKeys(null, kindOf)).toEqual({ titleKey: null, bodyKey: null })
    expect(notificationRenderKeys({}, kindOf)).toEqual({ titleKey: null, bodyKey: null })
    expect(notificationRenderKeys({ i18nKey: 42 }, kindOf)).toEqual({ titleKey: null, bodyKey: null })
    expect(notificationRenderKeys({ i18nBodyKey: "types.role_changed.body" }, kindOf)).toEqual({
      titleKey: null,
      bodyKey: "types.role_changed.body",
    })
  })
})

describe("pushUrlWithOrg", () => {
  it("leaves account-level (no org) notifications untouched", () => {
    expect(pushUrlWithOrg("/transactions", null)).toBe("/transactions")
    expect(pushUrlWithOrg(null, null)).toBeUndefined()
    expect(pushUrlWithOrg(undefined, undefined)).toBeUndefined()
  })

  it("appends no_org to an internal link, respecting an existing query", () => {
    expect(pushUrlWithOrg("/organizations/o1/members", "o1")).toBe("/organizations/o1/members?no_org=o1")
    expect(pushUrlWithOrg("/transactions?view=t1", "o2")).toBe("/transactions?view=t1&no_org=o2")
  })

  it("falls back to the notifications page when org-scoped but link-less", () => {
    expect(pushUrlWithOrg(null, "o1")).toBe("/notifications?no_org=o1")
    expect(pushUrlWithOrg("", "o1")).toBe("/notifications?no_org=o1")
  })

  it("never rewrites an external (http) link even when org-scoped", () => {
    expect(pushUrlWithOrg("https://example.com/x", "o1")).toBe("https://example.com/x")
  })

  it("url-encodes the org id", () => {
    expect(pushUrlWithOrg("/x", "a b&c")).toBe("/x?no_org=a%20b%26c")
  })
})

describe("decideNoOrgSwitch", () => {
  const members = ["o1", "o2"]

  it("does nothing (and does not strip) with no target", () => {
    expect(decideNoOrgSwitch(null, "o1", members, false)).toEqual({ strip: false, switchTo: null })
  })

  it("waits for orgs to load before acting (does not strip yet)", () => {
    // loading=true must NOT strip, or a cold start would drop the switch.
    expect(decideNoOrgSwitch("o2", "o1", [], true)).toEqual({ strip: false, switchTo: null })
  })

  it("switches to a member org that isn't already active", () => {
    expect(decideNoOrgSwitch("o2", "o1", members, false)).toEqual({ strip: true, switchTo: "o2" })
  })

  it("strips but does not switch when the target is already active", () => {
    expect(decideNoOrgSwitch("o1", "o1", members, false)).toEqual({ strip: true, switchTo: null })
  })

  it("strips but does not switch to a non-member org (stale push after leaving)", () => {
    expect(decideNoOrgSwitch("o9", "o1", members, false)).toEqual({ strip: true, switchTo: null })
  })
})
