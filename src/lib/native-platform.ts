import { Capacitor } from "@capacitor/core"

function isAndroidNativeRuntime() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"
}

function markNativeRuntime() {
  if (!Capacitor.isNativePlatform()) return

  const platform = Capacitor.getPlatform()
  document.documentElement.dataset.nativePlatform = platform
  document.documentElement.classList.add("capacitor-native", `capacitor-${platform}`)
}

function dismissTopOverlay() {
  const openOverlay = document.querySelector(
    [
      "[data-radix-dialog-content]",
      "[data-radix-dialog-overlay]",
      "[data-radix-dropdown-menu-content]",
      "[data-radix-popover-content]",
      "[data-vaul-drawer]",
      "[role='dialog']",
      "[role='menu']",
    ].join(","),
  )

  if (!openOverlay) return false

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  return true
}

export async function installNativePlatformHandlers() {
  markNativeRuntime()

  if (!isAndroidNativeRuntime()) return

  const { App } = await import("@capacitor/app")

  await App.addListener("backButton", async ({ canGoBack }) => {
    if (dismissTopOverlay()) return

    if (canGoBack || window.history.length > 1) {
      window.history.back()
      return
    }

    await App.minimizeApp()
  })
}
