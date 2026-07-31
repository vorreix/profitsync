import { afterEach, describe, expect, it, vi } from "vitest"

import { APP_STORE_URL, PLAY_STORE_URL, getMobileStoreUrl, isAndroidWeb, isIosWeb } from "./store-links"

function setUa(userAgent: string) {
  vi.stubGlobal("navigator", { userAgent })
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

describe("store-links", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("Play Store url is built from the applicationId", () => {
    expect(PLAY_STORE_URL).toContain("id=com.vorreix.profitsync")
  })

  it("Android web → Play Store", () => {
    setUa(ANDROID)
    expect(isAndroidWeb()).toBe(true)
    expect(getMobileStoreUrl()).toBe(PLAY_STORE_URL)
  })

  it("iOS web → App Store (or null until the URL is set)", () => {
    setUa(IPHONE)
    expect(isIosWeb()).toBe(true)
    expect(getMobileStoreUrl()).toBe(APP_STORE_URL) // currently null → iOS keeps the add-to-home-screen fallback
  })

  it("desktop → no store target (keeps the PWA install path)", () => {
    setUa(DESKTOP)
    expect(isAndroidWeb()).toBe(false)
    expect(isIosWeb()).toBe(false)
    expect(getMobileStoreUrl()).toBeNull()
  })
})
