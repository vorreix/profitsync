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
      // shadcn/ui is vendored (see CLAUDE.md) — treat it as third-party.
      "src/components/ui/**",
      // Stray scratch files left in the repo, not part of the app.
      "test-drizzle-returning.js",
      "**/*.bak",
    ],
  },

  // Frontend — browser runtime + React.
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

  // Backend (Vercel serverless functions) + config/build files — Node runtime.
  {
    files: ["api/**/*.ts", "*.config.{ts,js}"],
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
  // with no runtime/correctness impact — so turn it off for context files.
  {
    files: ["**/*-context.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },

  // Tests — Vitest globals available without imports.
  {
    files: ["**/*.test.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
)
