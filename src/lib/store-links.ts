// Native app store links + the "which store for this device" decision.
//
// On the marketing web (profitsync.net) the install affordance used to trigger a
// PWA install. On a phone we'd rather hand users the real native app, so the
// button routes mobile browsers to their platform's store instead (see
// src/components/InstallButton.tsx). Desktop keeps the PWA install path.

// Google Play — derived from the Capacitor/Gradle applicationId
// (`com.vorreix.profitsync`). This is the canonical listing URL; the Play Store
// app intercepts it on-device and opens the native listing.
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.vorreix.profitsync"

// Apple App Store — the listing URL needs the numeric app id, which isn't known
// in code yet.
// TODO(store): set this to the real listing once the iOS app is live, e.g.
//   "https://apps.apple.com/app/profitsync/id0000000000"
// While it is null, iOS falls back to the existing "Add to Home Screen" sheet.
export const APP_STORE_URL: string | null = null

function ua(): string {
  if (typeof navigator === "undefined") return ""
  return navigator.userAgent || ""
}

/** True on an Android phone/tablet web browser (not the native shell). */
export function isAndroidWeb(): boolean {
  return /android/i.test(ua())
}

/** True on an iOS device web browser (covers iPadOS's desktop-UA masquerade). */
export function isIosWeb(): boolean {
  const s = ua()
  if (!s) return false
  const iPadOsDesktop = s.includes("Macintosh") && typeof document !== "undefined" && "ontouchend" in document
  return /iphone|ipad|ipod/i.test(s) || iPadOsDesktop
}

/**
 * The store URL to send THIS device to instead of installing the PWA, or `null`
 * when we have no store target (desktop, or iOS before APP_STORE_URL is filled
 * in) — in which case the caller keeps its existing install behaviour.
 */
export function getMobileStoreUrl(): string | null {
  if (isAndroidWeb()) return PLAY_STORE_URL
  if (isIosWeb()) return APP_STORE_URL
  return null
}
