// Native (Capacitor) app-shell polish — the pieces that make the WebView feel
// like a real app rather than a browser tab: a theme-matched status bar,
// keyboard resize behaviour, a splash screen we dismiss the moment React is up,
// and tasteful haptics on key touches.
//
// Bundle discipline (identical to native-push.ts / native-reminders.ts): the
// @capacitor/* plugins are imported DYNAMICALLY inside guarded helpers and vite
// manualChunks routes @capacitor/* into the lazy "native" chunk, so importing
// THIS module from web code (e.g. MobileAppLayout calls `haptic()`) never drags
// the Capacitor runtime into the web bundle. Every helper no-ops on the web and
// never throws — shell polish must never be able to break the app.
import { isNativeApp, nativePlatform } from "@/lib/native-auth"

// ⚠️ Capacitor plugin objects are Proxies that forward EVERY property access —
// including `then` — to a native call. Resolving a promise WITH a plugin proxy
// makes the promise machinery invoke proxy.then() and hang forever. Always hand
// the proxy back INSIDE a wrapper object, never as the resolved value.
async function statusBar() {
  const mod = await import("@capacitor/status-bar")
  return { sb: mod.StatusBar, Style: mod.Style }
}
async function splashScreen() {
  const mod = await import("@capacitor/splash-screen")
  return { ss: mod.SplashScreen }
}
async function keyboard() {
  const mod = await import("@capacitor/keyboard")
  return { kb: mod.Keyboard, KeyboardResize: mod.KeyboardResize }
}
async function haptics() {
  const mod = await import("@capacitor/haptics")
  return { h: mod.Haptics, ImpactStyle: mod.ImpactStyle }
}

/**
 * Pure mapping theme → status-bar appearance, unit-tested without a device.
 * The @capacitor/status-bar `Style` enum is inverted-sounding: `Dark` means
 * "light icons for a dark background", `Light` means "dark icons for a light
 * background". We return a plain token and translate to the enum at call time.
 */
export function statusBarStyleForTheme(dark: boolean): "DARK" | "LIGHT" {
  return dark ? "DARK" : "LIGHT"
}

/** Add `native-app` + the platform name to <html> so native-only CSS can scope. */
function tagDocumentPlatform() {
  const platform = nativePlatform()
  if (!platform) return
  const el = document.documentElement
  el.classList.add("native-app", `platform-${platform}`)
}

let shellInitDone = false

/**
 * One-time shell bring-up, called once React has painted. Idempotent and
 * best-effort: dismiss the splash, set the keyboard to resize the layout (so
 * inputs are never covered), and paint the status bar to match the theme.
 */
export async function initNativeShell(dark: boolean): Promise<void> {
  if (!isNativeApp()) return
  tagDocumentPlatform()
  if (shellInitDone) {
    await syncStatusBarToTheme(dark)
    return
  }
  shellInitDone = true

  // Status bar overlays the WebView (edge-to-edge, modern Android/iOS) — the app
  // chrome already pads with env(safe-area-inset-top) via `.safe-pt`.
  try {
    const { sb, Style } = await statusBar()
    await sb.setOverlaysWebView({ overlay: true }).catch(() => {})
    await sb.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {})
  } catch {
    /* status-bar plugin unavailable — ignore */
  }

  // Keyboard: resize the WebView (not just scroll) so focused inputs stay
  // visible, and drop iOS's grey accessory toolbar for a cleaner field.
  try {
    const { kb, KeyboardResize } = await keyboard()
    await kb.setResizeMode({ mode: KeyboardResize.Native }).catch(() => {})
    await kb.setAccessoryBarVisible({ isVisible: false }).catch(() => {})
  } catch {
    /* keyboard plugin unavailable (e.g. web) — ignore */
  }

  // Hide the splash now that the app is interactive (config also auto-hides as a
  // safety net if JS never reaches this line).
  try {
    const { ss } = await splashScreen()
    await ss.hide().catch(() => {})
  } catch {
    /* splash-screen plugin unavailable — ignore */
  }
}

/** Repaint the status bar when the theme flips (light ⇄ dark). No-op on web. */
export async function syncStatusBarToTheme(dark: boolean): Promise<void> {
  if (!isNativeApp()) return
  try {
    const { sb, Style } = await statusBar()
    await sb.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {})
  } catch {
    /* ignore */
  }
}

/**
 * Whether openAppSettings() can deep-link to this app's page in the OS
 * Settings — iOS only. On iOS a denied microphone/camera permission can NEVER
 * be re-prompted by the app (the OS remembers the choice and instantly rejects
 * every request), so Settings is the only recovery and error UIs surface an
 * "Open settings" action. Android re-prompts through Capacitor's
 * runtime-permission flow on the next attempt, so no deep link is needed there.
 */
export function canOpenAppSettings(): boolean {
  return nativePlatform() === "ios"
}

/**
 * Deep-link to the app's page in the iOS Settings app. Navigating the WebView
 * to `app-settings:` is intentional, not a bug: Capacitor cancels any
 * top-level navigation to a non-app URL and hands it to UIApplication.open
 * (WebViewDelegationHandler.decidePolicyFor), which opens Settings — no plugin
 * needed, and the WebView itself never leaves the page.
 */
export function openAppSettings(): void {
  if (!canOpenAppSettings()) return
  window.location.assign("app-settings:")
}

export type HapticKind = "selection" | "light" | "medium"

/**
 * Fire-and-forget haptic feedback for a touch interaction. Safe to call from any
 * onClick on any platform — it self-guards and swallows every error, so callers
 * write `void haptic("selection")` with no ceremony.
 */
export async function haptic(kind: HapticKind = "selection"): Promise<void> {
  if (!isNativeApp()) return
  try {
    const { h, ImpactStyle } = await haptics()
    if (kind === "selection") {
      await h.selectionChanged().catch(() => {})
    } else {
      await h.impact({ style: kind === "medium" ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {})
    }
  } catch {
    /* haptics unavailable — ignore */
  }
}
