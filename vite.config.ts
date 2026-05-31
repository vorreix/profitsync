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
    // Split only the heavy charting libs (recharts/d3) into their own one-way
    // leaf chunk so they load lazily with the routes that use them. Everything
    // else — INCLUDING React — stays in a single "vendor" chunk.
    //
    // Do NOT isolate react/react-dom into its own chunk: that created a circular
    // dependency (vendor <-> react) which Rollup warned about and which broke the
    // production build at runtime with
    //   "TypeError: Cannot set properties of undefined (setting 'Activity')"
    // (React internals were accessed before the cross-referenced chunk had
    // initialized). Keeping React with the rest of vendor avoids the cycle.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return
          if (id.includes("recharts") || id.includes("d3-") || id.includes("victory-vendor")) return "charts"
          return "vendor"
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
})
