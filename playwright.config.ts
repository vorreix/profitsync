import { config as loadDotenv } from "dotenv"
import { defineConfig, devices } from "@playwright/test"

// Local runs read the same env the dev server uses; CI provides these as
// workflow env (Clerk keys + the dedicated e2e DATABASE_URL).
loadDotenv({ path: ".env.local" })

/**
 * E2E configuration. The suite runs against the Vite dev server (which serves
 * the API through the local middleware — the same dispatch path as
 * api/index.ts in production), signed in as a dedicated Clerk TEST user
 * (`…+clerk_test@…` verifies with code 424242, no email roundtrip).
 *
 * Environment:
 *   PLAYWRIGHT_BASE_URL  reuse an already-running server (defaults to the
 *                        webServer below on :5173)
 *   E2E_CLERK_EMAIL      the test account (default e2e+clerk_test@profitsync.dev)
 *   DATABASE_URL         in CI: a DEDICATED Neon branch (E2E_DATABASE_URL
 *                        secret) — never production
 *
 * Serial by design: the suite shares one signed-in user and asserts on real
 * data it creates (and cleans up) — parallel workers would race.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // Sign in once, persist the session for every spec.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
      testIgnore: [/mobile\.spec\.ts/, /prod-build\.spec\.ts/],
    },
    {
      // Pixel = Chromium-based, so CI only needs the chromium download.
      name: "mobile",
      use: { ...devices["Pixel 7"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
      testMatch: /mobile\.spec\.ts/,
    },
    {
      // PRODUCTION-BUILD smoke: boots the real `vite build` artifact (served by
      // `vite preview`) in a browser, signed out, and fails on any boot error.
      // The dev server can never catch build-only breakage — a circular
      // manualChunks graph white-screened EVERY page of a build that sailed
      // through the whole dev-server suite (2026-06-13). No auth, no DB.
      name: "prod-build",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4317" },
      testMatch: /prod-build\.spec\.ts/,
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : [
        {
          command: "npm run dev -- --port 5173 --strictPort",
          url: "http://localhost:5173",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          // Suppress the dev-only Agentation toolbar (DevAgentation.tsx): its
          // fixed overlay intercepts pointer events over the Add-Client FAB and
          // makes clicks time out. Vite exposes VITE_-prefixed process.env vars
          // on import.meta.env, so this reaches the client deterministically.
          env: { VITE_DISABLE_DEV_TOOLS: "1" },
        },
        {
          // Fresh production build for the prod-build project (no API needed).
          command: "npm run build && npm run preview -- --port 4317 --strictPort",
          url: "http://localhost:4317",
          reuseExistingServer: !process.env.CI,
          timeout: 300_000,
        },
      ],
})
