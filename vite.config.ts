import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Split large/independent vendors into separate, long-term-cacheable chunks
    // so a change in app code doesn't bust the whole vendor bundle, and heavy
    // libs (charts) load only with the routes that need them.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return
          if (id.includes("recharts") || id.includes("d3-") || id.includes("victory-vendor")) return "charts"
          if (id.includes("@clerk")) return "clerk"
          if (id.includes("react-router") || id.includes("@remix-run")) return "router"
          if (
            id.includes("radix-ui") ||
            id.includes("@radix-ui") ||
            id.includes("lucide-react") ||
            id.includes("cmdk") ||
            id.includes("vaul") ||
            id.includes("embla-carousel") ||
            id.includes("react-day-picker")
          ) {
            return "ui"
          }
          if (id.includes("/react-dom/") || id.includes("/react/") || id.includes("/scheduler/")) return "react"
          return "vendor"
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
})
