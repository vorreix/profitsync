import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "com.vorreix.profitsync",
  appName: "ProfitSync",
  webDir: "dist",
  backgroundColor: "#ffffff",
  server: {
    androidScheme: "https",
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    // The splash stays up until initNativeShell() dismisses it once React paints;
    // launchAutoHide is a 2s safety net so a boot failure can't hang on it.
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: "#ffffff",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    // Resize the WebView (not just scroll) when the keyboard opens so focused
    // inputs are never hidden behind it.
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
    // Edge-to-edge: the WebView draws under the status bar and the app chrome
    // pads with env(safe-area-inset-*). Icon colour is set per-theme at runtime.
    StatusBar: {
      overlaysWebView: true,
      style: "DEFAULT",
    },
    // Native Google Sign-In (src/lib/native-google-signin.ts). skipNativeAuth
    // keeps this a PURE credential provider: signInWithGoogle() returns the Google
    // ID token WITHOUT creating a Firebase user — we hand that token straight to
    // Clerk's google_one_tap strategy. `providers` scopes the SDKs linked natively.
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ["google.com", "apple.com"],
    },
  },
}

export default config
