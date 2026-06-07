import { Capacitor } from "@capacitor/core"

import {
  describeNativeAuthError,
  describeUrlForNativeAuthLog,
  nativeAuthDebugLog,
} from "@/lib/native-auth-debug"

export const NATIVE_OAUTH_SCHEME = "com.profitsync.app"
export const NATIVE_OAUTH_CALLBACK_URL = `${NATIVE_OAUTH_SCHEME}://oauth-callback`

export function isNativeAndroidRuntime() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"
}

function isNativeOAuthCallback(rawUrl: string) {
  try {
    const url = new URL(rawUrl)
    return url.protocol === `${NATIVE_OAUTH_SCHEME}:` && url.host === "oauth-callback"
  } catch {
    return false
  }
}

export async function installNativeOAuthCallbackHandler() {
  if (!isNativeAndroidRuntime()) return

  nativeAuthDebugLog("app launched in Capacitor/native mode", {
    platform: Capacitor.getPlatform(),
    callbackUrl: NATIVE_OAUTH_CALLBACK_URL,
  })

  const { App } = await import("@capacitor/app")

  await App.addListener("appUrlOpen", async ({ url }) => {
    nativeAuthDebugLog("deep link callback received", describeUrlForNativeAuthLog(url))

    if (!isNativeOAuthCallback(url)) return

    try {
      const { Browser } = await import("@capacitor/browser")
      await Browser.close()
    } catch (error) {
      nativeAuthDebugLog("Browser.close skipped or failed", describeNativeAuthError(error))
    }

    try {
      const callbackUrl = new URL(url)
      const callbackPath = `/sso-callback${callbackUrl.search}${callbackUrl.hash}`
      nativeAuthDebugLog("Clerk callback processing started", {
        callbackUrl: describeUrlForNativeAuthLog(url),
        pathname: callbackPath.split("?")[0],
      })
      window.location.assign(callbackPath)
    } catch (error) {
      nativeAuthDebugLog("Clerk callback failure", describeNativeAuthError(error), "error")
    }
  })
}
