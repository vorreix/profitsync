import { useSyncExternalStore } from "react"

// The browser's beforeinstallprompt event is not in the standard DOM lib types.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}

interface InstallState {
  canInstall: boolean
  isInstalled: boolean
  isIosSafari: boolean
}

const SERVER_STATE: InstallState = { canInstall: false, isInstalled: false, isIosSafari: false }

// Remembered across reloads: the browser tab can't tell that a PWA is already
// installed (display-mode is only "standalone" inside the installed app), so we
// record the `appinstalled` event and treat it as installed. It self-heals: Chrome
// only fires `beforeinstallprompt` when the app is NOT installed, so receiving that
// event clears the flag again (covers the uninstall case).
const INSTALLED_KEY = "profitsync-pwa-installed"

let deferredPrompt: BeforeInstallPromptEvent | null = null
let initialized = false
const listeners = new Set<() => void>()

function readInstalledFlag(): boolean {
  try {
    return localStorage.getItem(INSTALLED_KEY) === "1"
  } catch {
    return false
  }
}

function writeInstalledFlag(value: boolean): void {
  try {
    if (value) localStorage.setItem(INSTALLED_KEY, "1")
    else localStorage.removeItem(INSTALLED_KEY)
  } catch {
    /* ignore storage failures */
  }
}

function detectInstalled(): boolean {
  if (typeof window === "undefined") return false
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return Boolean(standalone || iosStandalone) || readInstalledFlag()
}

function detectIosSafari(): boolean {
  if (typeof window === "undefined") return false
  const ua = window.navigator.userAgent
  const isIos = /iphone|ipad|ipod/i.test(ua) || (ua.includes("Macintosh") && "ontouchend" in window.document)
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua)
  return isIos && isSafari && !detectInstalled()
}

let snapshot: InstallState = {
  canInstall: false,
  isInstalled: detectInstalled(),
  isIosSafari: detectIosSafari(),
}

function recompute(): void {
  snapshot = {
    canInstall: deferredPrompt !== null,
    isInstalled: detectInstalled(),
    isIosSafari: detectIosSafari(),
  }
  listeners.forEach((listener) => listener())
}

// Attach the capture listeners once. Called from initPwa() at app boot.
export function ensureInstallListener(): void {
  if (initialized || typeof window === "undefined") return
  initialized = true
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    // Chrome only fires this when the app is NOT installed — clear any stale flag.
    writeInstalledFlag(false)
    recompute()
  })
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null
    writeInstalledFlag(true)
    recompute()
  })
}

function subscribe(listener: () => void): () => void {
  ensureInstallListener()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): InstallState {
  return snapshot
}

function getServerSnapshot(): InstallState {
  return SERVER_STATE
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false
  await deferredPrompt.prompt()
  const choice = await deferredPrompt.userChoice
  deferredPrompt = null
  if (choice.outcome === "accepted") writeInstalledFlag(true)
  recompute()
  return choice.outcome === "accepted"
}

export function useInstallPrompt(): InstallState & { promptInstall: typeof promptInstall } {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return { ...state, promptInstall }
}
