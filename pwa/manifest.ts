import type { ManifestOptions } from "vite-plugin-pwa"

// The installed-app manifest. start_url is /dashboard so launching the home-screen
// icon goes straight into the product (AppLayout redirects to /login when signed out).
// scope is "/" because the app's routes (/login, /dashboard, /clients, …) are all
// siblings of the landing page "/", with no narrower shared prefix; the landing page
// is kept out of the PWA by sw-policy.ts + conditional registration instead.
export const manifest: Partial<ManifestOptions> = {
  name: "ProfitSync",
  short_name: "ProfitSync",
  description:
    "ProfitSync brings your clients, cash flow, and quotations into one clean workspace — so you always know exactly where your money stands.",
  id: "/dashboard",
  start_url: "/dashboard",
  scope: "/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#ffffff",
  lang: "en",
  dir: "ltr",
  categories: ["business", "finance", "productivity"],
  icons: [
    { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}
