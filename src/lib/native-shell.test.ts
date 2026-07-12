import { describe, expect, it } from "vitest"
import { statusBarStyleForTheme } from "./native-shell"

// The @capacitor/status-bar `Style` enum is inverted-sounding: `Dark` = light
// icons for a dark background, `Light` = dark icons for a light background. This
// pure mapping is what the runtime translates to the enum, so lock it here (no
// device / no capacitor import needed — the plugin loads lazily inside helpers).
describe("statusBarStyleForTheme", () => {
  it("dark theme → DARK (light status-bar icons)", () => {
    expect(statusBarStyleForTheme(true)).toBe("DARK")
  })

  it("light theme → LIGHT (dark status-bar icons)", () => {
    expect(statusBarStyleForTheme(false)).toBe("LIGHT")
  })
})
