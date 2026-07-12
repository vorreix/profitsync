import js from "@eslint/js"
import globals from "globals"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tseslint from "typescript-eslint"

export default tseslint.config(
  // Files we never lint.
  {
    ignores: [
      "dist",
      "build",
      "coverage",
      "node_modules",
      ".codex_tmp/**",
      ".npm-cache/**",
      "android/app/build/**",
      "android/build/**",
      // iOS Capacitor project — Swift + generated JS (cap-synced bundle, SPM
      // artifacts under DerivedData). None of it is app source we lint.
      "ios/**",
      // Vercel build output (vercel build / boot-functions) â€” generated, never linted.
      ".vercel",
      // shadcn/ui is vendored (see CLAUDE.md) â€” treat it as third-party.
      "src/components/ui/**",
      // Stray scratch files left in the repo, not part of the app.
      "test-drizzle-returning.js",
      "**/*.bak",
    ],
  },

  // Frontend â€” browser runtime + React.
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Allow intentional unused via leading underscore.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },

  // Backend (Vercel serverless functions) + config/build files â€” Node runtime.
  // pwa/ holds build-time service-worker config consumed by vite.config.ts.
  {
    files: ["api/**/*.ts", "pwa/**/*.ts", "*.config.{ts,js}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },

  // Context modules intentionally colocate a Provider component with its hook
  // (e.g. OrgProvider + useOrg), which trips the Fast Refresh boundary rule.
  // That colocation is deliberate here, and the rule is a dev-only HMR hint
  // with no runtime/correctness impact â€” so turn it off for context files.
  {
    files: ["**/*-context.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },

  // Tests â€” Vitest globals available without imports.
  {
    files: ["**/*.test.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
)


