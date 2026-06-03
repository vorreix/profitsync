import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

import { buildPwaPlugin } from "./pwa/vite-pwa"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), buildPwaPlugin()],
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
          // Isolate the marketing landing page into its own chunk so it can be kept
          // out of the PWA precache (see pwa/sw-policy.ts PRECACHE_GLOB_IGNORES).
          if (id.includes("/src/landing/")) return "landing"
          if (!id.includes("node_modules")) return
          if (id.includes("recharts") || id.includes("d3-") || id.includes("victory-vendor")) return "charts"
          // The Markdown renderer (react-markdown + the remark/unified/micromark/
          // mdast/hast tree) is only used on the blog article + admin blog routes.
          // Keep it in its own one-way leaf chunk so it loads lazily with those
          // routes instead of bloating the eager "vendor" chunk on every page.
          if (
            id.includes("react-markdown") ||
            id.includes("/remark-") ||
            id.includes("/micromark") ||
            id.includes("/mdast-") ||
            id.includes("/hast-") ||
            id.includes("/hastscript/") ||
            id.includes("/unist-") ||
            id.includes("/unified/") ||
            id.includes("/vfile") ||
            id.includes("/property-information/") ||
            id.includes("/character-entities") ||
            id.includes("/decode-named-character-reference/")
          ) {
            return "markdown"
          }
          return "vendor"
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
})
