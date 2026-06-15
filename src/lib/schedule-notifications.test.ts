import { describe, it, expect } from "vitest"
import {
  reminderDueSlot,
  nextRecurringFire,
  firstBroadcastFire,
  weekdayInTz,
  timeInTz,
  dateInTz,
  describeReminderSchedule,
} from "./schedule-notifications"
import type { ReminderSchedule } from "./types"

const utc = (s: string) => new Date(s)

describe("timezone wall-clock helpers", () => {
  it("reads weekday/time/date in a given tz", () => {
    // 2026-06-14T12:30:00Z is a Sunday.
    const d = utc("2026-06-14T12:30:00Z")
    expect(weekdayInTz(d, "UTC")).toBe(7) // Sun
    expect(timeInTz(d, "UTC")).toBe("12:30")
    expect(dateInTz(d, "UTC")).toBe("2026-06-14")
  })

  it("shifts across the date line by tz", () => {
    // 2026-06-14T01:00:00Z is still 2026-06-13 in New York (UTC-4 in June).
    const d = utc("2026-06-14T01:00:00Z")
    expect(dateInTz(d, "America/New_York")).toBe("2026-06-13")
    expect(timeInTz(d, "America/New_York")).toBe("21:00")
  })
})

describe("reminderDueSlot", () => {
  const sched = (over: Partial<ReminderSchedule> = {}): ReminderSchedule => ({
    times: ["09:00"],
    weekdays: [],
    timezone: "UTC",
    ...over,
  })

  it("fires the slot when the time has passed and it never fired", () => {
    const now = utc("2026-06-14T09:03:00Z")
    expect(reminderDueSlot(sched(), now, null)).toBe("2026-06-14T09:00")
  })

  it("does not fire before the scheduled time", () => {
    const now = utc("2026-06-14T08:59:00Z")
    expect(reminderDueSlot(sched(), now, null)).toBeNull()
  })

  it("does not double-fire the same slot", () => {
    const now = utc("2026-06-14T09:08:00Z")
    const fired = utc("2026-06-14T09:03:00Z")
    expect(reminderDueSlot(sched(), now, fired)).toBeNull()
  })

  it("fires a later slot the same day after an earlier one already fired", () => {
    const now = utc("2026-06-14T18:02:00Z")
    const fired = utc("2026-06-14T09:03:00Z")
    expect(reminderDueSlot(sched({ times: ["09:00", "18:00"] }), now, fired)).toBe("2026-06-14T18:00")
  })

  it("fires the latest passed slot, not stale earlier ones", () => {
    const now = utc("2026-06-14T19:00:00Z")
    expect(reminderDueSlot(sched({ times: ["09:00", "18:00"] }), now, null)).toBe("2026-06-14T18:00")
  })

  it("respects the weekday filter", () => {
    const sun = utc("2026-06-14T09:03:00Z") // Sunday
    expect(reminderDueSlot(sched({ weekdays: [1, 2, 3, 4, 5] }), sun, null)).toBeNull()
    const mon = utc("2026-06-15T09:03:00Z") // Monday
    expect(reminderDueSlot(sched({ weekdays: [1, 2, 3, 4, 5] }), mon, null)).toBe("2026-06-15T09:00")
  })

  it("fires again the next day after firing the previous day", () => {
    const now = utc("2026-06-15T09:03:00Z")
    const firedYesterday = utc("2026-06-14T09:03:00Z")
    expect(reminderDueSlot(sched(), now, firedYesterday)).toBe("2026-06-15T09:00")
  })

  it("returns null with no times", () => {
    expect(reminderDueSlot(sched({ times: [] }), utc("2026-06-14T09:03:00Z"), null)).toBeNull()
  })
})

describe("nextRecurringFire", () => {
  it("advances daily by interval", () => {
    const r = nextRecurringFire({ freq: "daily", interval: 1 }, utc("2026-06-14T09:00:00Z"))
    expect(r?.toISOString()).toBe("2026-06-15T09:00:00.000Z")
  })
  it("advances weekly", () => {
    const r = nextRecurringFire({ freq: "weekly", interval: 2 }, utc("2026-06-14T09:00:00Z"))
    expect(r?.toISOString()).toBe("2026-06-28T09:00:00.000Z")
  })
  it("advances monthly", () => {
    const r = nextRecurringFire({ freq: "monthly", interval: 1 }, utc("2026-06-14T09:00:00Z"))
    expect(r?.toISOString()).toBe("2026-07-14T09:00:00.000Z")
  })
  it("stops after `until`", () => {
    const r = nextRecurringFire(
      { freq: "daily", interval: 1, until: "2026-06-14T23:59:00Z" },
      utc("2026-06-14T09:00:00Z"),
    )
    expect(r).toBeNull()
  })
})

describe("firstBroadcastFire", () => {
  it("is null for immediate sends", () => {
    expect(firstBroadcastFire({ type: "now" })).toBeNull()
  })
  it("is the start instant for scheduled/recurring", () => {
    expect(firstBroadcastFire({ type: "at", at: "2026-06-20T10:00:00Z" })?.toISOString()).toBe(
      "2026-06-20T10:00:00.000Z",
    )
  })
})

describe("describeReminderSchedule", () => {
  it("summarizes weekdays + times", () => {
    expect(describeReminderSchedule({ times: ["09:00", "18:00"], weekdays: [1, 2, 3, 4, 5], timezone: "UTC" })).toBe(
      "Mon–Fri at 09:00, 18:00",
    )
    expect(describeReminderSchedule({ times: ["08:00"], weekdays: [], timezone: "UTC" })).toBe("Every day at 08:00")
  })
})
