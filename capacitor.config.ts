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
  },
}

export default config
