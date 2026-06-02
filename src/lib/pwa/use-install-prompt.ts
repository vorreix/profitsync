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

let deferredPrompt: BeforeInstallPromptEvent | null = null
let initialized = false
const listeners = new Set<() => void>()

function detectInstalled(): boolean {
  if (typeof window === "undefined") return false
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return Boolean(standalone || iosStandalone)
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
    canInstall: deferredPrompt !== null && !detectInstalled(),
    isInstalled: detectInstalled(),
    isIosSafari: detectIosSafari(),
  }
  listeners.forEach((listener) => listener())
}

// Attach the capture listeners once. Called from initPwa() (so it's gated to
// login-onward routes, exactly where the event can fire once the SW is active) and
// from subscribe() as a backstop.
export function ensureInstallListener(): void {
  if (initialized || typeof window === "undefined") return
  initialized = true
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    recompute()
  })
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null
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
  recompute()
  return choice.outcome === "accepted"
}

export function useInstallPrompt(): InstallState & { promptInstall: typeof promptInstall } {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return { ...state, promptInstall }
}
