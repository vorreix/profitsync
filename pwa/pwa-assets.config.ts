import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config"

// DEPRECATED — favicons/app icons are now the realfavicongenerator set committed
// directly in public/ (favicon.ico, favicon-96x96.png, apple-touch-icon.png,
// web-app-manifest-{192,512}.png), wired up in index.html + pwa/manifest.ts.
//
// Do NOT run `npm run pwa:icons` to refresh icons: this generator emits a DIFFERENT
// naming scheme (pwa-*.png, maskable-icon-512x512.png, apple-touch-icon-180x180.png)
// and would OVERWRITE public/favicon.ico with a logo.png-derived one, breaking the
// current set. To update icons, regenerate via realfavicongenerator and replace the
// files in public/ instead. Kept here only for reference.
export default defineConfig({
  preset: minimal2023Preset,
  images: ["public/logo.png"],
})
