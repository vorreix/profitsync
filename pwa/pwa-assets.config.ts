import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config"

// Generates the PWA icon set from the brand logo into public/:
//   pwa-64x64.png, pwa-192x192.png, pwa-512x512.png,
//   maskable-icon-512x512.png, apple-touch-icon-180x180.png, favicon.ico
// Run with: npm run pwa:icons
export default defineConfig({
  preset: minimal2023Preset,
  images: ["public/logo.png"],
})
