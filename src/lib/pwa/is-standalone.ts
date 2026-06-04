// True ONLY when the page is actually running inside the installed PWA window
// (standalone / fullscreen / minimal-ui display modes, or iOS' navigator.standalone).
//
// Deliberately does NOT consult the "was installed" localStorage flag used by
// use-install-prompt.ts: a user who installed the app but is browsing the site
// in a normal browser tab should still see the marketing landing. Only the real
// installed-app window should be sent straight into the product.
const DISPLAY_MODES = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"]

export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false
  const byDisplayMode = DISPLAY_MODES.some((mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches)
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return byDisplayMode || iosStandalone
}
