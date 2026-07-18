/// <reference types="vitest/config" />
import path from "path"
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { config as loadDotenv } from "dotenv"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type ViteDevServer } from "vite"
import type { IncomingMessage, ServerResponse } from "node:http"

import { buildPwaPlugin } from "./pwa/vite-pwa"

const viteModeEqualsArg = process.argv.find((arg) => arg.startsWith("--mode="))
const viteModeFlagIndex = process.argv.indexOf("--mode")
const viteMode = viteModeEqualsArg?.split("=", 2)[1] ?? (viteModeFlagIndex >= 0 ? process.argv[viteModeFlagIndex + 1] : undefined) ?? process.env.NODE_ENV

if (viteMode === "android-local") {
  loadDotenv({ path: ".env.android.local", override: true })
} else if (viteMode === "android") {
  loadDotenv({ path: ".env.android", override: true })
} else if (viteMode === "ios-local") {
  loadDotenv({ path: ".env.ios.local", override: true })
} else if (viteMode === "ios") {
  loadDotenv({ path: ".env.ios", override: true })
} else {
  loadDotenv({ path: ".env.local" })
  loadDotenv()
}

// A production native build (--mode android|ios) ships whatever key is in its
// .env — warn (non-fatally) if that's a Clerk DEV key, since the published app
// would then point at the dev instance. Not an error: the *-local shell builds
// intentionally use pk_test_ against a LAN dev server.
if ((viteMode === "android" || viteMode === "ios") && process.env.VITE_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_")) {
  console.warn(
    `\n⚠️  [native] --mode ${viteMode} is a PRODUCTION build but VITE_CLERK_PUBLISHABLE_KEY is a pk_test_ (dev) key.\n` +
    `   The store build would target your Clerk DEV instance. Put a pk_live_… key in .env.${viteMode} before publishing.\n`,
  )
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return undefined
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString("utf8")
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function attachVercelResponseMethods(res: ServerResponse) {
  const response = res as ServerResponse & {
    status: (code: number) => typeof response
    json: (body: unknown) => void
  }
  response.status = (code: number) => {
    response.statusCode = code
    return response
  }
  response.json = (body: unknown) => {
    if (!response.headersSent) response.setHeader("Content-Type", "application/json")
    response.end(JSON.stringify(body))
  }
  return response
}

function localApiPlugin() {
  return {
    name: "profitsync-local-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api", async (req, res) => {
        try {
          const originalUrl = req.url ?? "/"
          const requestUrl = new URL(originalUrl, "http://localhost")
          const apiPath = requestUrl.pathname.replace(/^\/+api\/?/, "").replace(/^\/+/, "")
          const query: Record<string, string | string[]> = { __apipath: apiPath }
          requestUrl.searchParams.forEach((value, key) => {
            const existing = query[key]
            if (existing === undefined) query[key] = value
            else query[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
          })

          const apiReq = req as IncomingMessage & {
            query: Record<string, string | string[]>
            body?: unknown
          }
          apiReq.query = query
          apiReq.body = await readJsonBody(req)
          const apiRes = attachVercelResponseMethods(res)
          const mod = await server.ssrLoadModule("/api/index.ts")
          await mod.default(apiReq, apiRes)
        } catch (err) {
          console.error("[local-api] request failed", err)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader("Content-Type", "application/json")
          }
          res.end(JSON.stringify({ error: "Local API request failed" }))
        }
      })
    },
  }
}

// After a production build, copy the final dist/index.html (with hash-busted
// asset references and the PWA transforms already applied) to a path the SSR
// function bundles via vercel.json `functions.includeFiles`. api/ssr.ts reads
// this template at runtime and injects per-page <head> + content into its
// sentinels. Build-only; in dev the public pages are served by Vite directly.
function ssrTemplatePlugin() {
  return {
    name: "profitsync-ssr-template",
    apply: "build" as const,
    closeBundle() {
      const src = path.resolve(__dirname, "dist/index.html")
      if (!existsSync(src)) return
      const destDir = path.resolve(__dirname, "api/_ssr")
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
      copyFileSync(src, path.join(destDir, "index-template.html"))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [localApiPlugin(), react(), tailwindcss(), buildPwaPlugin(), ssrTemplatePlugin()],
  // Keep the dev watcher OFF the giant generated trees (the android/ios native
  // projects and the Go worker) — chokidar walking them exhausts macOS's
  // file-descriptor limit (EMFILE: too many open files, which kills `vercel dev`
  // mid-boot) and gradle build noise triggers pointless full reloads.
  server: {
    watch: {
      ignored: ["**/android/**", "**/ios/**", "**/worker/**", "**/dist/**"],
    },
  },
  // Vitest config. Two concerns:
  //  - `env`: the committed unit suite is DB-FREE (it runs zero queries), but
  //    some test files import modules that transitively pull in src/lib/db,
  //    whose top-level `neon(process.env.DATABASE_URL!)` THROWS at import when
  //    the var is unset. Locally `.env.local` provides it; CI's unit gate does
  //    not â€” and shouldn't need a real database. Hand the test worker a harmless
  //    placeholder so the Neon client can CONSTRUCT (it never connects, since no
  //    query runs). A real DATABASE_URL always wins.
  //  - `exclude`: keep Playwright's e2e/*.spec.ts out of the Vitest run.
  test: {
    env: {
      // Not a credential â€” a syntactically-valid dummy so the Neon client can
      // construct in tests; it never connects (no queries run). secret-scan:ignore
      DATABASE_URL: process.env.DATABASE_URL || "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder", // secret-scan:ignore
    },
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // @capacitor-firebase/messaging's WEB implementation imports the firebase
      // JS SDK (optional peer). We only use the plugin on native — web push is
      // our own VAPID pipeline — so satisfy rollup with a tiny stub instead of
      // shipping the whole SDK. See src/lib/firebase-messaging-stub.ts.
      "firebase/messaging": path.resolve(__dirname, "./src/lib/firebase-messaging-stub.ts"),
      // Same treatment for @capacitor-firebase/authentication (native Google
      // Sign-In -> Clerk google_one_tap). Its web impl statically imports
      // firebase/auth; we only use the native bridge. See firebase-auth-stub.ts.
      "firebase/auth": path.resolve(__dirname, "./src/lib/firebase-auth-stub.ts"),
    },
  },
  build: {
    // Split only the heavy charting libs (recharts/d3) into their own one-way
    // leaf chunk so they load lazily with the routes that use them. Everything
    // else â€” INCLUDING React â€” stays in a single "vendor" chunk.
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
          // React Flow must NOT fall through into "vendor": it depends on d3-zoom/
          // d3-drag, which the rule below routes into "charts". With @xyflow in
          // vendor that made vendor <-> charts circular, and the charts chunk then
          // initialized before vendor's React was ready â€”
          //   "TypeError: Cannot read properties of undefined (reading 'forwardRef')"
          // at boot on EVERY page (vendor is eager), i.e. a total white screen.
          // Keeping it in its own one-way leaf ("flow" -> "charts" -> "vendor")
          // breaks the cycle, and only the lazy /flow route ever loads it.
          if (id.includes("@xyflow")) return "flow"
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
          // Capacitor bridge modules: only the native WebView ever loads them
          // (App.tsx guards the dynamic import with isNativeAndroid), so keep
          // them out of the eager web "vendor" chunk. One-way leaf — they
          // import nothing from our other chunks, so the graph stays acyclic.
          // @capacitor-firebase (FCM) rides the same rule.
          if (id.includes("@capacitor/") || id.includes("@capacitor-firebase/")) return "native"
          return "vendor"
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
})



