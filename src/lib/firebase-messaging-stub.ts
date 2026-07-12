// Build-time stub for the `firebase/messaging` OPTIONAL peer dependency of
// @capacitor-firebase/messaging (aliased in vite.config.ts).
//
// Why: the plugin's WEB implementation (dist/esm/web.js) imports the firebase
// JS SDK, but ProfitSync only uses the plugin on NATIVE Android/iOS — web push
// stays on our own VAPID pipeline (src/lib/pwa/web-push.ts). Installing the
// full firebase SDK just to satisfy rollup would add a heavy, never-executed
// prod dependency. Every call path is gated by isNativePushSupported(), so
// this code can only run if something bypasses that gate — in which case the
// loud error beats a silent no-op.
const notInstalled = () => {
  throw new Error("firebase web SDK is not installed — native push is Android/iOS-only (see src/lib/native-push.ts)")
}

export const getMessaging = notInstalled
export const getToken = notInstalled
export const deleteToken = notInstalled
export const onMessage = notInstalled
export const isSupported = async (): Promise<boolean> => false
