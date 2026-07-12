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
  },
}

export default config
