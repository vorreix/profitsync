# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (Vite)
npm run build        # Type-check then bundle for production
npm run typecheck    # TypeScript type check only (no emit)
npm run preview      # Preview production build locally
```

There is no test suite configured. There is no lint script — TypeScript (`tsc --noEmit`) is the primary static analysis tool.

## Environment

The app requires two env vars (create `.env.local`):

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

These are consumed in `src/lib/supabase.ts` to initialize the Supabase client.

## Architecture

**Stack:** React 19 + TypeScript + Vite, Tailwind CSS v4 (via `@tailwindcss/vite` plugin), shadcn/ui (new-york style), react-router-dom v7, Supabase (auth + Postgres), react-hook-form + zod, recharts.

**Path alias:** `@/` resolves to `src/`.

### Routing

`src/App.tsx` is the root. Two route groups:

- **Auth routes** (`/login`, `/signup`, `/forgot-password`, `/reset-password`) — rendered without `AppLayout`, no auth guard.
- **App routes** (`/dashboard`, `/clients`, `/clients/:id`, `/profile`) — wrapped in `AppLayout`, which guards access by checking `supabase.auth.getUser()` on mount and redirecting to `/login` if unauthenticated.

### AppLayout

`src/components/AppLayout.tsx` provides the collapsible sidebar shell via shadcn's `SidebarProvider`. All protected pages render as `<Outlet />` inside it. Auth guard lives here (not as a separate wrapper component).

### Data layer

All database types are defined in `src/lib/supabase.ts` alongside the singleton Supabase client:

| Type | Table | Notes |
|---|---|---|
| `Client` | `clients` | status: `active` \| `inactive` \| `archived` |
| `Transaction` | `transactions` | type: `incoming` \| `outgoing` |
| `TransactionAttachment` | `transaction_attachments` | linked to a transaction |
| `UserProfile` | `user_profiles` | references `auth.users`, holds default `currency` |

`CURRENCIES` (list of ISO codes) is also exported from this file and used across the app for currency selection.

### Supabase / Database

Migrations live in `supabase/migrations/`. Current schema:

- `clients` — core client records.
- `transactions` — income/expense entries per client (cascades on client delete). RLS currently allows anon access for demo; this should be tightened to `auth.uid()`-scoped policies when auth is fully wired.
- `transaction_attachments` — file metadata per transaction (RLS: authenticated users only).
- `user_profiles` — one row per auth user; stores `full_name` and `currency`. RLS scoped to `auth.uid() = id`.

### UI components

`src/components/ui/` contains shadcn components — treat these as vendored, not project code. Avoid editing them directly; add new shadcn components with the CLI (`npx shadcn@latest add <component>`).

Custom components live directly in `src/components/` (e.g. `AppLayout`, `theme-provider`, `mode-toggle`).

### Theme

Dark/light mode is managed via `next-themes` (`ThemeProvider` in `src/components/theme-provider.tsx`) with a toggle in `src/components/mode-toggle.tsx`. Tailwind CSS variables drive theming via `cssVariables: true` in `components.json`.

## Product context

See `project_idea.md` for the full product spec. Key domain concepts: **Clients** are the central entity; **Transactions** (incoming payments and outgoing expenses) belong to a client and drive per-client and dashboard financials; **Quotations** (not yet implemented in the codebase) have a Won/Not-Won status and can be converted into clients; the user's **default currency** (set in their profile) applies app-wide. The dashboard aggregates across all or a filtered subset of clients.
