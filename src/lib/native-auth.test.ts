import { afterEach, describe, expect, it, vi } from "vitest"
import { isNativeAndroid, isNativeApp, nativePlatform, toInternalOAuthCallbackPath } from "./native-auth"

// The platform helpers read the window.Capacitor bridge global (never a static
// @capacitor/core import — bundle discipline). Simulate the bridge with stubGlobal;
// the test env is node, so `window` is otherwise undefined.
function setBridge(cap: unknown) {
  vi.stubGlobal("window", cap === undefined ? {} : { Capacitor: cap })
}

afterEach(() => vi.unstubAllGlobals())

describe("nativePlatform / isNativeApp / isNativeAndroid", () => {
  it("is non-native when there is no Capacitor bridge (plain web)", () => {
    setBridge(undefined)
    expect(nativePlatform()).toBeNull()
    expect(isNativeApp()).toBe(false)
    expect(isNativeAndroid()).toBe(false)
  })

  it("detects android", () => {
    setBridge({ isNativePlatform: () => true, getPlatform: () => "android" })
    expect(nativePlatform()).toBe("android")
    expect(isNativeApp()).toBe(true)
    expect(isNativeAndroid()).toBe(true)
  })

  it("detects ios — and ios is a native app but NOT android", () => {
    setBridge({ isNativePlatform: () => true, getPlatform: () => "ios" })
    expect(nativePlatform()).toBe("ios")
    expect(isNativeApp()).toBe(true)
    expect(isNativeAndroid()).toBe(false)
  })

  it("treats Capacitor's web platform as non-native", () => {
    setBridge({ isNativePlatform: () => false, getPlatform: () => "web" })
    expect(nativePlatform()).toBeNull()
    expect(isNativeApp()).toBe(false)
  })

  it("ignores an unrecognized platform string even when isNativePlatform() is true", () => {
    setBridge({ isNativePlatform: () => true, getPlatform: () => "windows" })
    expect(nativePlatform()).toBeNull()
    expect(isNativeApp()).toBe(false)
  })
})

describe("toInternalOAuthCallbackPath (the ONE custom scheme, shared by android + ios)", () => {
  it("converts the deep-link callback into an internal /sso-callback path with its query", () => {
    expect(
      toInternalOAuthCallbackPath("com.vorreix.profitsync://oauth-callback?code=abc&state=xyz"),
    ).toBe("/sso-callback?code=abc&state=xyz")
  })

  it("rejects other schemes, other hosts, and non-URLs", () => {
    expect(toInternalOAuthCallbackPath("https://profitsync.net/sso-callback?code=abc")).toBeNull()
    expect(toInternalOAuthCallbackPath("com.vorreix.profitsync://something-else?code=abc")).toBeNull()
    expect(toInternalOAuthCallbackPath("not a url")).toBeNull()
  })
})
