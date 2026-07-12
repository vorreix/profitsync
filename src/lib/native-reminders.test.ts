import { describe, expect, it } from "vitest"
import { capacitorWeekday, expandSchedules, localNotificationId } from "./native-reminders"

// Pure schedule-projection math only — the plugin calls need a device and are
// verified on the emulator (docs/notifications/V6_PLAN.md).
describe("capacitorWeekday", () => {
  it("maps ISO (1=Mon…7=Sun) to Capacitor (1=Sun…7=Sat)", () => {
    expect(capacitorWeekday(1)).toBe(2) // Mon
    expect(capacitorWeekday(6)).toBe(7) // Sat
    expect(capacitorWeekday(7)).toBe(1) // Sun
  })
})

describe("localNotificationId", () => {
  it("is stable and positive int32", () => {
    const a = localNotificationId("rem-1", 1, "09:00")
    expect(a).toBe(localNotificationId("rem-1", 1, "09:00"))
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThanOrEqual(0x7fffffff)
  })

  it("differs across slots of the same reminder", () => {
    const ids = new Set([
      localNotificationId("rem-1", 1, "09:00"),
      localNotificationId("rem-1", 2, "09:00"),
      localNotificationId("rem-1", 1, "18:30"),
      localNotificationId("rem-2", 1, "09:00"),
    ])
    expect(ids.size).toBe(4)
  })
})

describe("expandSchedules", () => {
  const base = { id: "r1", enabled: true, label: "Log expenses" }

  it("expands weekdays × times with mapped weekday numbers", () => {
    const out = expandSchedules({ ...base, schedule: { times: ["09:00", "18:30"], weekdays: [1, 7] } })
    expect(out).toHaveLength(4)
    expect(out.map((s) => s.weekday).sort()).toEqual([1, 1, 2, 2]) // Sun→1, Mon→2
    expect(out.find((s) => s.hour === 18)?.minute).toBe(30)
  })

  it("empty weekdays = one daily schedule per time (weekday null)", () => {
    const out = expandSchedules({ ...base, schedule: { times: ["07:15"], weekdays: [] } })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ weekday: null, hour: 7, minute: 15 })
  })

  it("disabled reminders and malformed times produce nothing", () => {
    expect(expandSchedules({ ...base, enabled: false, schedule: { times: ["09:00"], weekdays: [1] } })).toEqual([])
    expect(expandSchedules({ ...base, schedule: { times: ["late"], weekdays: [1] } })).toEqual([])
  })
})
