# Design: Supabase → Clerk + Neon Migration

**Date:** 2026-05-23
**Status:** Approved

---

## 1. Goal

Replace Supabase (auth + Postgres) with:
- **Clerk** for authentication (email/password, OTP verification, password reset)
- **Neon.tech** for the PostgreSQL database
- **Vercel Serverless Functions** (`api/` directory) as the API layer between the SPA and Neon
- **Drizzle ORM** for type-safe database queries

The Vite React SPA itself stays unchanged in structure — only data access and auth primitives change.

---

## 2. Architecture

```
Browser (Vite SPA)
  │
  ├─ Auth: @clerk/clerk-react
  │    ├─ <ClerkProvider> wraps the app in main.tsx
  │    ├─ useAuth() / useUser() replace supabase.auth.*
  │    └─ Clerk hosted UI for sign-in / sign-up (redirect-based)
  │
  └─ API: fetch('/api/*', { Authorization: 'Bearer <clerk-jwt>' })
       │
       └─ Vercel Serverless Functions (api/*.ts)
            ├─ Verify Clerk JWT → extract userId
            ├─ Drizzle ORM queries against Neon (HTTP driver)
            └─ Return JSON
```

---

## 3. Auth (Clerk)

### 3.1 Frontend

- Install `@clerk/clerk-react`
- `VITE_CLERK_PUBLISHABLE_KEY` added to `.env.local`
- `<ClerkProvider>` wraps `<App>` in `src/main.tsx`
- Auth pages (`/login`, `/signup`, `/forgot-password`, `/reset-password`) redirect to Clerk's hosted sign-in/sign-up UI. The existing route placeholders can either be kept as redirects or removed — Clerk's hosted pages handle all auth flows including OTP and password reset.
- `AppLayout` auth guard replaces `supabase.auth.getUser()` with:
  ```ts
  const { isLoaded, isSignedIn } = useAuth()
  // redirect to Clerk sign-in URL if !isSignedIn
  ```
- Logout: `signOut()` from `useClerk()`
- User email in sidebar: `useUser().user.primaryEmailAddress.emailAddress`

### 3.2 API layer JWT verification

- Install `@clerk/backend`
- `CLERK_SECRET_KEY` added to `.env.local` (server-side, not prefixed with VITE_)
- Each Vercel function calls `createClerkClient({ secretKey }).authenticateRequest(req)` to verify the JWT and extract `userId`
- Unauthenticated requests return `401`

### 3.3 User profiles

- `user_profiles.id` changes from `uuid REFERENCES auth.users` to `text` (Clerk user ID, format: `user_2abc...`)
- On `GET /api/profile`, the function upserts a profile row if one doesn't exist yet (first login handling)
- No FK to an external auth table — Clerk is the source of truth for identity

---

## 4. Database Schema (Drizzle)

Schema lives in `src/lib/db/schema.ts`. Mirrors current SQL schema with two changes:

1. `user_profiles.id` → `text` (Clerk user ID)
2. `clients` gets a new `user_id text NOT NULL` column to scope records per user (replaces Supabase RLS)
3. `transactions` inherits user scoping via FK to `clients`

**Tables:**

```ts
// clients — adds user_id for per-user data isolation
export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  company: text("company").default(""),
  email: text("email").default(""),
  phone: text("phone").default(""),
  status: text("status").default("active"),
  notes: text("notes").default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})

// transactions — unchanged except inherits user scope via client FK
export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'incoming' | 'outgoing'
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  description: text("description").default(""),
  category: text("category").default(""),
  date: date("date").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})

// user_profiles — id is now a Clerk user ID string
export const userProfiles = pgTable("user_profiles", {
  id: text("id").primaryKey(), // Clerk userId
  email: text("email").notNull().unique(),
  fullName: text("full_name"),
  currency: text("currency").default("USD"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})
```

No RLS policies needed — auth enforcement moves to the API layer.

---

## 5. Drizzle Client

`src/lib/db/index.ts`:

```ts
import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"

const sql = neon(process.env.DATABASE_URL!)
export const db = drizzle(sql)
```

`DATABASE_URL` is the Neon connection string (pooled). In local dev it's set in `.env.local`; on Vercel it's set via the Neon integration.

---

## 6. API Routes

All routes in the `api/` directory. Each verifies the Clerk JWT first.

| File | Methods | Description |
|---|---|---|
| `api/clients.ts` | GET, POST | List user's clients; create a client |
| `api/clients/[id].ts` | GET, PATCH, DELETE | Single client by id |
| `api/transactions.ts` | GET (by `?clientId=`), POST | List transactions; create |
| `api/transactions/[id].ts` | PATCH, DELETE | Update/delete a transaction |
| `api/profile.ts` | GET, PATCH | Get (upsert on first call) / update user profile |

**Auth pattern per route:**

```ts
import { createClerkClient } from "@clerk/backend"
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

export default async function handler(req, res) {
  const { isAuthenticated, toAuth } = await clerk.authenticateRequest(req, { headerToken: req.headers.authorization?.replace("Bearer ", "") })
  if (!isAuthenticated) return res.status(401).json({ error: "Unauthorized" })
  const { userId } = toAuth()
  // ... query db with userId
}
```

---

## 7. Frontend Data Layer

`src/lib/supabase.ts` is replaced by:

- `src/lib/api.ts` — typed fetch helpers that include the Clerk JWT automatically:
  ```ts
  import { useAuth } from "@clerk/clerk-react"
  // used as: const { getToken } = useAuth()
  // apiGet('/api/clients') → fetch('/api/clients', { headers: { Authorization: `Bearer ${token}` } })
  ```
- `src/lib/types.ts` — the TypeScript types (`Client`, `Transaction`, etc.) moved here, unchanged

All Supabase imports removed. Pages that currently call `supabase.from('clients').select(...)` are updated to call `apiGet('/api/clients')` etc.

---

## 8. Local Development

1. Install Vercel CLI: `npm i -g vercel`
2. Link the project: `vercel link`
3. `.env.local`:
   ```
   VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   DATABASE_URL=postgresql://...@ep-xxx.neon.tech/neondb?sslmode=require
   ```
4. Run: `vercel dev` — serves the Vite frontend and `api/` functions together on `localhost:3000`

No separate `npm run dev` needed when using `vercel dev`. Add `vercel.json` to configure rewrites:

```json
{
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api/$1" }]
}
```

---

## 9. Migration Steps (Database)

Since the Neon database is fresh, run the schema via Drizzle's migration tool (`drizzle-kit push`) rather than porting the existing SQL migration files. The `supabase/` directory can be archived or deleted.

---

## 10. Files Changed / Added

**Removed:**
- `supabase/` directory (migrations, Supabase config)
- `src/lib/supabase.ts`
- `.env.local` values: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

**Added:**
- `api/clients.ts`, `api/clients/[id].ts`
- `api/transactions.ts`, `api/transactions/[id].ts`
- `api/profile.ts`
- `src/lib/db/schema.ts`
- `src/lib/db/index.ts`
- `src/lib/api.ts` (typed fetch helpers)
- `src/lib/types.ts` (moved from supabase.ts)
- `vercel.json`
- `drizzle.config.ts`

**Modified:**
- `src/main.tsx` — add `<ClerkProvider>`
- `src/components/AppLayout.tsx` — Clerk auth guard + logout
- `src/pages/LoginPage.tsx` — redirect to Clerk sign-in URL
- `src/pages/SignupPage.tsx` — redirect to Clerk sign-up URL
- `src/pages/ForgotPasswordPage.tsx` — redirect (Clerk handles this)
- `src/pages/ResetPasswordPage.tsx` — redirect (Clerk handles this)
- `src/pages/Dashboard.tsx` — update data fetching
- `src/pages/ClientsPage.tsx` — update data fetching
- `src/pages/ClientDetailPage.tsx` — update data fetching
- `src/pages/ProfilePage.tsx` — update data fetching + Clerk user data
- `package.json` — add `@clerk/clerk-react`, `@clerk/backend`, `drizzle-orm`, `@neondatabase/serverless`, `drizzle-kit`; remove `@supabase/supabase-js`
- `CLAUDE.md` — update env vars and dev command
