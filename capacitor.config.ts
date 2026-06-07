import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "com.profitsync.app",
  appName: "ProfitSync",
  webDir: "dist",
  backgroundColor: "#ffffff",
  server: {
    androidScheme: "https",
  },
}

export default config
