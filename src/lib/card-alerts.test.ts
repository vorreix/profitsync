import { describe, expect, it } from "vitest"
import { cardStatusKey, expiryAlert } from "@/components/cards/card-dates"
import type { Card } from "@/lib/types"

const TODAY = "2026-09-06"

function card(over: Partial<Card> = {}): Pick<Card, "status" | "expiry_month" | "expiry_year"> {
  return { status: "active", expiry_month: 12, expiry_year: 2030, ...over } as Card
}

describe("expiryAlert", () => {
  it("says nothing about a card that expires comfortably later", () => {
    // The whole point of the tile's alert rail is that an empty rail means
    // "nothing needs you" — a chip here would spend that signal.
    expect(expiryAlert(card({ expiry_month: 12, expiry_year: 2030 }), TODAY)).toBeNull()
  })

  it("warns at exactly 30 days and stays quiet at 31", () => {
    // A card marked 09/26 is valid THROUGH 2026-09-30, so the window opens on
    // 2026-08-31 — one day earlier is still 31 days out and says nothing.
    expect(expiryAlert(card({ expiry_month: 9, expiry_year: 2026 }), "2026-08-31")?.days).toBe(30)
    expect(expiryAlert(card({ expiry_month: 9, expiry_year: 2026 }), "2026-08-31")?.tier).toBe("soon")
    expect(expiryAlert(card({ expiry_month: 9, expiry_year: 2026 }), "2026-08-30")).toBeNull()
  })

  it("warns while the card still works this month", () => {
    const a = expiryAlert(card({ expiry_month: 9, expiry_year: 2026 }), TODAY)
    expect(a?.tier).toBe("soon")
    expect(a?.days).toBe(24)
    expect(a?.expiry).toBe("09/26")
  })

  it("escalates the day after the expiry month ends", () => {
    expect(expiryAlert(card({ expiry_month: 9, expiry_year: 2026 }), "2026-09-30")?.tier).toBe("soon")
    expect(expiryAlert(card({ expiry_month: 9, expiry_year: 2026 }), "2026-10-01")?.tier).toBe("expired")
  })

  it("reports how far past the date an expired card is", () => {
    const a = expiryAlert(card({ expiry_month: 7, expiry_year: 2026 }), TODAY)
    expect(a?.tier).toBe("expired")
    expect(a?.days).toBe(-37)
  })

  it("stays quiet when no expiry was ever saved", () => {
    expect(expiryAlert(card({ expiry_month: null, expiry_year: null }), TODAY)).toBeNull()
    expect(expiryAlert(card({ expiry_month: 9, expiry_year: null }), TODAY)).toBeNull()
  })

  it("does not chase a closed card about its expiry", () => {
    expect(expiryAlert(card({ status: "closed", expiry_month: 7, expiry_year: 2026 }), TODAY)).toBeNull()
  })

  it("still warns on a frozen card — it will need replacing either way", () => {
    expect(expiryAlert(card({ status: "frozen", expiry_month: 9, expiry_year: 2026 }), TODAY)?.tier).toBe("soon")
  })
})

describe("cardStatusKey", () => {
  it("ranks closed over frozen over expired", () => {
    expect(cardStatusKey(card({ status: "closed", expiry_month: 1, expiry_year: 2020 }), TODAY)).toBe("statusClosed")
    expect(cardStatusKey(card({ status: "frozen", expiry_month: 1, expiry_year: 2020 }), TODAY)).toBe("statusFrozen")
    expect(cardStatusKey(card({ expiry_month: 1, expiry_year: 2020 }), TODAY)).toBe("statusExpired")
    expect(cardStatusKey(card(), TODAY)).toBe("statusActive")
  })
})
