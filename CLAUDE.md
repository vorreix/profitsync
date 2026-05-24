# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
vercel dev           # Start dev server (Vite frontend + API functions on port 3000)
npm run build        # Type-check then bundle for production
npm run typecheck    # TypeScript type check only (no emit)
npm run preview      # Preview production build locally
npm run db:push      # Push Drizzle schema to Neon (requires .env.local)
```

There is no test suite configured. There is no lint script — TypeScript (`tsc --noEmit`) is the primary static analysis tool.

## Environment

The app requires three env vars in `.env.local` (never commit this file):

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...   # Browser-side Clerk key
CLERK_SECRET_KEY=sk_test_...             # Server-side only — never expose to browser
DATABASE_URL=postgresql://...            # Neon connection string
```

## Architecture

**Stack:** React 19 + TypeScript + Vite, Tailwind CSS v4 (via `@tailwindcss/vite` plugin), shadcn/ui (new-york style), react-router-dom v7, Clerk (auth), Neon (Postgres via Drizzle ORM), Vercel serverless functions (`api/` directory), recharts.

**Path alias:** `@/` resolves to `src/`.

### Routing

`src/App.tsx` is the root. Two route groups:

- **Auth routes** (`/login/*`, `/signup/*`, `/forgot-password`, `/reset-password`) — rendered without `AppLayout`, no auth guard. Note: Clerk requires `/*` glob patterns for multi-step auth flows.
- **App routes** (`/dashboard`, `/clients`, `/clients/:id`, `/profile`) — wrapped in `AppLayout`, which guards access via Clerk's `useAuth()` and redirects to `/login` if unauthenticated.

### AppLayout

`src/components/AppLayout.tsx` provides the collapsible sidebar shell via shadcn's `SidebarProvider`. Auth guard uses `useAuth()` from `@clerk/clerk-react`. Returns null while loading or if not signed in.

### Data layer

Types are defined in `src/lib/types.ts`:

| Type | Table | Notes |
|---|---|---|
| `Client` | `clients` | status: `active` \| `inactive` \| `archived`; has `user_id` scoping |
| `Transaction` | `transactions` | type: `incoming` \| `outgoing` |
| `UserProfile` | `user_profiles` | id = Clerk userId (string); holds `full_name` and `currency` |

`CURRENCIES` (list of ISO codes) is exported from `src/lib/types.ts`.

Drizzle schema lives in `src/lib/db/schema.ts`. The `serialize()` helper in `src/lib/db/index.ts` converts Drizzle's camelCase output back to snake_case before `res.json()` in all API routes.

API fetch helpers (`apiGet`, `apiPost`, `apiPatch`, `apiDelete`) live in `src/lib/api.ts` — they attach the Clerk JWT via `Authorization: Bearer <token>`.

### API layer

All backend logic is in `api/` as Vercel serverless functions:

- `api/profile.ts` — GET (upsert on first call) + PATCH
- `api/clients.ts` — GET all + POST
- `api/clients/[id].ts` — GET one + PATCH + DELETE
- `api/transactions.ts` — GET by `?clientId=` + POST
- `api/transactions/[id].ts` — PATCH + DELETE

Every route verifies the Clerk JWT with `clerk.verifyToken(token)` and scopes all DB queries by `userId`.

### UI components

`src/components/ui/` contains shadcn components — treat these as vendored, not project code. Avoid editing them directly; add new shadcn components with the CLI (`npx shadcn@latest add <component>`).

Custom components live directly in `src/components/` (e.g. `AppLayout`, `theme-provider`, `mode-toggle`).

### Theme

Dark/light mode is managed via `next-themes` (`ThemeProvider` in `src/components/theme-provider.tsx`) with a toggle in `src/components/mode-toggle.tsx`. Tailwind CSS variables drive theming via `cssVariables: true` in `components.json`.

## Product context

See `project_idea.md` for the full product spec. Key domain concepts: **Clients** are the central entity; **Transactions** (incoming payments and outgoing expenses) belong to a client and drive per-client and dashboard financials; **Quotations** (not yet implemented in the codebase) have a Won/Not-Won status and can be converted into clients; the user's **default currency** (set in their profile) applies app-wide. The dashboard aggregates across all or a filtered subset of clients.
