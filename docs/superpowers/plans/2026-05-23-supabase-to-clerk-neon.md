# Supabase → Clerk + Neon Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase (auth + Postgres) with Clerk (auth), Neon (Postgres via Drizzle ORM), and Vercel serverless functions as the API layer — keeping the Vite React SPA structure intact.

**Architecture:** The browser calls `/api/*` endpoints (Vercel serverless functions) with a Clerk JWT in the Authorization header. Each function verifies the token, extracts the `userId`, then runs type-safe Drizzle queries against Neon. The frontend uses `@clerk/clerk-react` hooks for auth state; all Supabase SDK calls are removed.

**Tech Stack:** `@clerk/clerk-react`, `@clerk/backend`, `drizzle-orm`, `@neondatabase/serverless`, `drizzle-kit`, `@vercel/node`, Vercel CLI (`vercel dev` for local)

---

## File Map

**Create:**
- `src/lib/types.ts` — shared TypeScript types (Client, Transaction, UserProfile, CURRENCIES)
- `src/lib/db/schema.ts` — Drizzle table definitions
- `src/lib/db/index.ts` — Drizzle + Neon client singleton
- `src/lib/api.ts` — typed fetch helpers (apiGet, apiPost, apiPatch, apiDelete)
- `api/profile.ts` — GET/PATCH user profile
- `api/clients.ts` — GET list + POST create
- `api/clients/[id].ts` — GET one + PATCH + DELETE
- `api/transactions.ts` — GET by clientId + POST create
- `api/transactions/[id].ts` — PATCH + DELETE
- `drizzle.config.ts` — drizzle-kit config
- `vercel.json` — SPA rewrite + build config

**Modify:**
- `package.json` — swap deps
- `src/main.tsx` — add ClerkProvider
- `src/App.tsx` — update auth route paths to `/*` globs
- `src/components/AppLayout.tsx` — Clerk auth guard
- `src/pages/LoginPage.tsx` — embed `<SignIn />`
- `src/pages/SignupPage.tsx` — embed `<SignUp />`
- `src/pages/ForgotPasswordPage.tsx` — redirect to /login
- `src/pages/ResetPasswordPage.tsx` — redirect to /login
- `src/pages/Dashboard.tsx` — use apiGet
- `src/pages/ClientsPage.tsx` — use apiGet/apiPost
- `src/pages/ClientDetailPage.tsx` — use apiGet/apiPost/apiPatch/apiDelete
- `src/pages/ProfilePage.tsx` — use apiGet/apiPatch + Clerk user

**Delete:**
- `src/lib/supabase.ts`
- `supabase/` directory

---

## Task 1: Swap Dependencies in package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove Supabase, add new packages**

Open `package.json` and replace the entire file with this (all other fields stay identical — just change the `dependencies` and `devDependencies` sections):

```json
{
  "name": "shadcn-ui-template",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "typecheck": "tsc --noEmit",
    "preview": "vite preview",
    "db:push": "drizzle-kit push"
  },
  "dependencies": {
    "@clerk/clerk-react": "^5.0.0",
    "@hookform/resolvers": "^5.2.2",
    "@neondatabase/serverless": "^0.10.4",
    "@tailwindcss/vite": "^4.2.1",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "cmdk": "^1.1.1",
    "date-fns": "^4.1.0",
    "drizzle-orm": "^0.44.0",
    "embla-carousel-react": "^8.6.0",
    "input-otp": "^1.4.2",
    "lucide-react": "^1.6.0",
    "next-themes": "^0.4.6",
    "radix-ui": "^1.4.3",
    "react": "^19.2.4",
    "react-day-picker": "^9.14.0",
    "react-dom": "^19.2.4",
    "react-hook-form": "^7.72.0",
    "react-resizable-panels": "^4.7.6",
    "react-router-dom": "^7.15.1",
    "recharts": "^3.8.0",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.5.0",
    "tailwindcss": "^4.2.1",
    "tw-animate-css": "^1.4.0",
    "vaul": "^1.1.2",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@clerk/backend": "^1.0.0",
    "@types/node": "^24.12.0",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vercel/node": "^3.2.0",
    "@vitejs/plugin-react": "^5.2.0",
    "dotenv": "^16.4.5",
    "drizzle-kit": "^0.31.0",
    "typescript": "~5.9.3",
    "vite": "^7.3.1"
  }
}
```

- [ ] **Step 2: Install**

```bash
npm install
```

Expected: clean install, no errors about `@supabase/supabase-js`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: swap supabase for clerk, drizzle-orm, neon"
```

---

## Task 2: Create Shared Types

**Files:**
- Create: `src/lib/types.ts`

- [ ] **Step 1: Create the types file**

Create `src/lib/types.ts`:

```ts
export type Client = {
  id: string
  user_id: string
  name: string
  company: string
  email: string
  phone: string
  status: "active" | "inactive" | "archived"
  notes: string
  created_at: string
  updated_at: string
}

export type Transaction = {
  id: string
  client_id: string
  type: "incoming" | "outgoing"
  amount: number
  description: string
  category: string
  date: string
  created_at: string
  updated_at: string
}

export type UserProfile = {
  id: string
  email: string
  full_name: string
  currency: string
  created_at: string
  updated_at: string
}

export const CURRENCIES = [
  "USD", "EUR", "GBP", "CAD", "AUD", "JPY",
  "INR", "CHF", "CNY", "SEK", "NZD",
]
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add shared types file"
```

---

## Task 3: Create Drizzle Schema and DB Client

**Files:**
- Create: `src/lib/db/schema.ts`
- Create: `src/lib/db/index.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Create schema**

Create `src/lib/db/schema.ts`:

```ts
import { pgTable, uuid, text, numeric, date, timestamp } from "drizzle-orm/pg-core"

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

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  description: text("description").default(""),
  category: text("category").default(""),
  date: date("date").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})

export const userProfiles = pgTable("user_profiles", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name"),
  currency: text("currency").default("USD"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})
```

- [ ] **Step 2: Create the DB client**

Create `src/lib/db/index.ts`:

```ts
import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import * as schema from "./schema"

const sql = neon(process.env.DATABASE_URL!)
export const db = drizzle(sql, { schema })
```

- [ ] **Step 3: Create drizzle.config.ts**

Create `drizzle.config.ts` in the project root:

```ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/index.ts drizzle.config.ts
git commit -m "feat: add drizzle schema, db client, and drizzle config"
```

---

## Task 4: Create API Fetch Helpers

**Files:**
- Create: `src/lib/api.ts`

- [ ] **Step 1: Create the helpers**

Create `src/lib/api.ts`:

```ts
async function request<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const apiGet = <T>(path: string, token: string) => request<T>("GET", path, token)
export const apiPost = <T>(path: string, token: string, body: unknown) => request<T>("POST", path, token, body)
export const apiPatch = <T>(path: string, token: string, body: unknown) => request<T>("PATCH", path, token, body)
export const apiDelete = (path: string, token: string) => request<void>("DELETE", path, token)
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: add typed api fetch helpers"
```

---

## Task 5: Create Vercel API — Profile Route

**Files:**
- Create: `api/profile.ts`

- [ ] **Step 1: Create the profile handler**

Create `api/profile.ts`:

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClerkClient } from "@clerk/backend"
import { db } from "../src/lib/db"
import { userProfiles } from "../src/lib/db/schema"
import { eq } from "drizzle-orm"

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! })

async function getAuth(req: VercelRequest): Promise<string | null> {
  const token = req.headers.authorization?.replace("Bearer ", "")
  if (!token) return null
  try {
    const payload = await clerk.verifyToken(token)
    return payload.sub
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getAuth(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  if (req.method === "GET") {
    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.id, userId))

    if (!profile) {
      const clerkUser = await clerk.users.getUser(userId)
      const email = clerkUser.emailAddresses[0]?.emailAddress ?? ""
      const [created] = await db
        .insert(userProfiles)
        .values({ id: userId, email, fullName: clerkUser.fullName ?? "" })
        .returning()
      return res.json(created)
    }

    return res.json(profile)
  }

  if (req.method === "PATCH") {
    const { full_name, currency } = req.body as { full_name?: string; currency?: string }
    const [updated] = await db
      .update(userProfiles)
      .set({
        ...(full_name !== undefined ? { fullName: full_name } : {}),
        ...(currency !== undefined ? { currency } : {}),
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.id, userId))
      .returning()
    return res.json(updated)
  }

  return res.status(405).json({ error: "Method not allowed" })
}
```

- [ ] **Step 2: Commit**

```bash
git add api/profile.ts
git commit -m "feat: add profile api route"
```

---

## Task 6: Create Vercel API — Clients Routes

**Files:**
- Create: `api/clients.ts`
- Create: `api/clients/[id].ts`

- [ ] **Step 1: Create clients list + create route**

Create `api/clients.ts`:

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClerkClient } from "@clerk/backend"
import { db } from "../src/lib/db"
import { clients } from "../src/lib/db/schema"
import { eq, desc } from "drizzle-orm"

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! })

async function getAuth(req: VercelRequest): Promise<string | null> {
  const token = req.headers.authorization?.replace("Bearer ", "")
  if (!token) return null
  try {
    const payload = await clerk.verifyToken(token)
    return payload.sub
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getAuth(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  if (req.method === "GET") {
    const rows = await db
      .select()
      .from(clients)
      .where(eq(clients.userId, userId))
      .orderBy(desc(clients.createdAt))
    return res.json(rows)
  }

  if (req.method === "POST") {
    const { name, company, email, phone, status, notes } = req.body as {
      name: string; company?: string; email?: string
      phone?: string; status?: string; notes?: string
    }
    if (!name?.trim()) return res.status(400).json({ error: "name is required" })
    const [row] = await db
      .insert(clients)
      .values({ userId, name, company: company ?? "", email: email ?? "", phone: phone ?? "", status: status ?? "active", notes: notes ?? "" })
      .returning()
    return res.status(201).json(row)
  }

  return res.status(405).json({ error: "Method not allowed" })
}
```

- [ ] **Step 2: Create single-client route**

Create `api/clients/[id].ts`:

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClerkClient } from "@clerk/backend"
import { db } from "../../src/lib/db"
import { clients } from "../../src/lib/db/schema"
import { and, eq } from "drizzle-orm"

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! })

async function getAuth(req: VercelRequest): Promise<string | null> {
  const token = req.headers.authorization?.replace("Bearer ", "")
  if (!token) return null
  try {
    const payload = await clerk.verifyToken(token)
    return payload.sub
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getAuth(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })
  const { id } = req.query as { id: string }

  if (req.method === "GET") {
    const [row] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.userId, userId)))
    if (!row) return res.status(404).json({ error: "Not found" })
    return res.json(row)
  }

  if (req.method === "PATCH") {
    const { name, company, email, phone, status, notes } = req.body as {
      name?: string; company?: string; email?: string
      phone?: string; status?: string; notes?: string
    }
    const [updated] = await db
      .update(clients)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(company !== undefined ? { company } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(notes !== undefined ? { notes } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(clients.id, id), eq(clients.userId, userId)))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json(updated)
  }

  if (req.method === "DELETE") {
    await db
      .delete(clients)
      .where(and(eq(clients.id, id), eq(clients.userId, userId)))
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
```

- [ ] **Step 3: Commit**

```bash
git add api/clients.ts "api/clients/[id].ts"
git commit -m "feat: add clients api routes"
```

---

## Task 7: Create Vercel API — Transactions Routes

**Files:**
- Create: `api/transactions.ts`
- Create: `api/transactions/[id].ts`

- [ ] **Step 1: Create transactions list + create route**

Create `api/transactions.ts`:

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClerkClient } from "@clerk/backend"
import { db } from "../src/lib/db"
import { clients, transactions } from "../src/lib/db/schema"
import { and, eq, desc } from "drizzle-orm"

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! })

async function getAuth(req: VercelRequest): Promise<string | null> {
  const token = req.headers.authorization?.replace("Bearer ", "")
  if (!token) return null
  try {
    const payload = await clerk.verifyToken(token)
    return payload.sub
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getAuth(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  if (req.method === "GET") {
    const { clientId } = req.query as { clientId?: string }

    // Verify the client belongs to this user
    if (clientId) {
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.userId, userId)))
      if (!client) return res.status(403).json({ error: "Forbidden" })
    }

    const rows = await db
      .select()
      .from(transactions)
      .where(clientId ? eq(transactions.clientId, clientId) : undefined)
      .orderBy(desc(transactions.date))
    return res.json(rows)
  }

  if (req.method === "POST") {
    const { client_id, type, amount, description, category, date } = req.body as {
      client_id: string; type: string; amount: number
      description?: string; category?: string; date?: string
    }

    // Verify client ownership
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, client_id), eq(clients.userId, userId)))
    if (!client) return res.status(403).json({ error: "Forbidden" })

    if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: "amount is required" })
    if (!["incoming", "outgoing"].includes(type)) return res.status(400).json({ error: "type must be incoming or outgoing" })

    const today = new Date().toISOString().split("T")[0]
    const [row] = await db
      .insert(transactions)
      .values({
        clientId: client_id,
        type,
        amount: String(amount),
        description: description ?? "",
        category: category ?? "",
        date: date ?? today,
      })
      .returning()
    return res.status(201).json(row)
  }

  return res.status(405).json({ error: "Method not allowed" })
}
```

- [ ] **Step 2: Create single-transaction route**

Create `api/transactions/[id].ts`:

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClerkClient } from "@clerk/backend"
import { db } from "../../src/lib/db"
import { clients, transactions } from "../../src/lib/db/schema"
import { and, eq } from "drizzle-orm"

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! })

async function getAuth(req: VercelRequest): Promise<string | null> {
  const token = req.headers.authorization?.replace("Bearer ", "")
  if (!token) return null
  try {
    const payload = await clerk.verifyToken(token)
    return payload.sub
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getAuth(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })
  const { id } = req.query as { id: string }

  // Look up transaction + verify ownership via join on clients
  const [row] = await db
    .select({ tx: transactions, clientUserId: clients.userId })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(eq(transactions.id, id))

  if (!row || row.clientUserId !== userId) return res.status(404).json({ error: "Not found" })

  if (req.method === "PATCH") {
    const { type, amount, description, category, date } = req.body as {
      type?: string; amount?: number; description?: string; category?: string; date?: string
    }
    const [updated] = await db
      .update(transactions)
      .set({
        ...(type !== undefined ? { type } : {}),
        ...(amount !== undefined ? { amount: String(amount) } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(date !== undefined ? { date } : {}),
      })
      .where(eq(transactions.id, id))
      .returning()
    return res.json(updated)
  }

  if (req.method === "DELETE") {
    await db.delete(transactions).where(eq(transactions.id, id))
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
```

- [ ] **Step 3: Commit**

```bash
git add api/transactions.ts "api/transactions/[id].ts"
git commit -m "feat: add transactions api routes"
```

---

## Task 8: Add vercel.json

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Create config**

Create `vercel.json`:

```json
{
  "rewrites": [
    {
      "source": "/((?!api).*)",
      "destination": "/index.html"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "chore: add vercel.json for SPA routing"
```

---

## Task 9: Wire Clerk into the Frontend

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add ClerkProvider to main.tsx**

Replace the entire content of `src/main.tsx`:

```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ClerkProvider } from "@clerk/clerk-react"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env.local")
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ClerkProvider>
  </StrictMode>
)
```

- [ ] **Step 2: Update auth route paths in App.tsx to support Clerk sub-routing**

Replace the content of `src/App.tsx`:

```tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { AppLayout } from "@/components/AppLayout"
import { Dashboard } from "@/pages/Dashboard"
import { ClientsPage } from "@/pages/ClientsPage"
import { ClientDetailPage } from "@/pages/ClientDetailPage"
import { LoginPage } from "@/pages/LoginPage"
import { SignupPage } from "@/pages/SignupPage"
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage"
import { ResetPasswordPage } from "@/pages/ResetPasswordPage"
import { ProfilePage } from "@/pages/ProfilePage"
import { Toaster } from "@/components/ui/sonner"

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Auth Routes — /* glob required for Clerk's multi-step routing */}
        <Route path="login/*" element={<LoginPage />} />
        <Route path="signup/*" element={<SignupPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />

        {/* App Routes */}
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="clients/:id" element={<ClientDetailPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}

export default App
```

- [ ] **Step 3: Commit**

```bash
git add src/main.tsx src/App.tsx
git commit -m "feat: wire ClerkProvider into frontend entry"
```

---

## Task 10: Update AppLayout Auth Guard

**Files:**
- Modify: `src/components/AppLayout.tsx`

- [ ] **Step 1: Replace the entire file**

Replace the entire content of `src/components/AppLayout.tsx`:

```tsx
import { useEffect } from "react"
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom"
import { useAuth, useUser, useClerk } from "@clerk/clerk-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ModeToggle } from "@/components/mode-toggle"
import { LayoutDashboard, Users, TrendingUp, User, LogOut } from "lucide-react"

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Clients", href: "/clients", icon: Users },
]

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { isLoaded, isSignedIn } = useAuth()
  const { user } = useUser()
  const { signOut } = useClerk()

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      navigate("/login")
    }
  }, [isLoaded, isSignedIn, navigate])

  if (!isLoaded || !isSignedIn) return null

  const userEmail = user?.primaryEmailAddress?.emailAddress ?? null

  const handleLogout = async () => {
    await signOut()
    navigate("/login")
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="pb-0">
          <div className="flex items-center gap-2 px-2 py-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <TrendingUp className="size-4" />
            </div>
            <span className="font-semibold text-sm tracking-tight group-data-[collapsible=icon]:hidden">
              ProfitSync
            </span>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname === item.href || location.pathname.startsWith(item.href + "/")}
                      tooltip={item.label}
                    >
                      <NavLink to={item.href}>
                        <item.icon />
                        <span>{item.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <div className="flex items-center gap-2">
            <div className="px-2 py-2 group-data-[collapsible=icon]:px-0">
              <ModeToggle />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="group-data-[collapsible=icon]:size-10">
                  <User className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex flex-col space-y-1">
                  <span>Account</span>
                  {userEmail && <span className="text-xs font-normal text-muted-foreground">{userEmail}</span>}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/profile")}>
                  <User className="size-4 mr-2" />
                  Profile Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                  <LogOut className="size-4 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium text-muted-foreground">
            {navItems.find((n) => location.pathname === n.href || location.pathname.startsWith(n.href + "/"))?.label ?? ""}
          </span>
        </header>

        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/AppLayout.tsx
git commit -m "feat: replace supabase auth guard with Clerk in AppLayout"
```

---

## Task 11: Update Auth Pages

**Files:**
- Modify: `src/pages/LoginPage.tsx`
- Modify: `src/pages/SignupPage.tsx`
- Modify: `src/pages/ForgotPasswordPage.tsx`
- Modify: `src/pages/ResetPasswordPage.tsx`

- [ ] **Step 1: Update LoginPage to embed Clerk's SignIn**

Replace the entire content of `src/pages/LoginPage.tsx`:

```tsx
import { SignIn } from "@clerk/clerk-react"

export function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <SignIn path="/login" routing="path" signUpUrl="/signup" afterSignInUrl="/dashboard" />
    </div>
  )
}
```

- [ ] **Step 2: Update SignupPage to embed Clerk's SignUp**

Replace the entire content of `src/pages/SignupPage.tsx`:

```tsx
import { SignUp } from "@clerk/clerk-react"

export function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <SignUp path="/signup" routing="path" signInUrl="/login" afterSignUpUrl="/dashboard" />
    </div>
  )
}
```

- [ ] **Step 3: Update ForgotPasswordPage and ResetPasswordPage to redirect**

Replace the entire content of `src/pages/ForgotPasswordPage.tsx`:

```tsx
import { Navigate } from "react-router-dom"

export function ForgotPasswordPage() {
  return <Navigate to="/login" replace />
}
```

Replace the entire content of `src/pages/ResetPasswordPage.tsx`:

```tsx
import { Navigate } from "react-router-dom"

export function ResetPasswordPage() {
  return <Navigate to="/login" replace />
}
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/LoginPage.tsx src/pages/SignupPage.tsx src/pages/ForgotPasswordPage.tsx src/pages/ResetPasswordPage.tsx
git commit -m "feat: replace auth pages with Clerk embedded components"
```

---

## Task 12: Update Dashboard

**Files:**
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: Replace data fetching**

In `src/pages/Dashboard.tsx`, replace the import at the top:

Find:
```tsx
import { supabase, type Client, type Transaction } from "@/lib/supabase"
```

Replace with:
```tsx
import { useAuth } from "@clerk/clerk-react"
import { apiGet } from "@/lib/api"
import type { Client, Transaction } from "@/lib/types"
```

- [ ] **Step 2: Add useAuth hook and replace the load function**

Find the component body opening:
```tsx
export function Dashboard() {
  const navigate = useNavigate()
  const [clients, setClients] = useState<ClientWithStats[]>([])
  const [loading, setLoading] = useState(true)
```

Replace with:
```tsx
export function Dashboard() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [clients, setClients] = useState<ClientWithStats[]>([])
  const [loading, setLoading] = useState(true)
```

- [ ] **Step 3: Replace the load useEffect**

Find:
```tsx
  useEffect(() => {
    async function load() {
      const [clientsRes, txRes] = await Promise.all([
        supabase.from("clients").select("*").order("created_at", { ascending: false }),
        supabase.from("transactions").select("*"),
      ])

      const clientList: Client[] = clientsRes.data ?? []
      const txList: Transaction[] = txRes.data ?? []
```

Replace with:
```tsx
  useEffect(() => {
    async function load() {
      const token = await getToken()
      if (!token) return

      const [clientList, txList] = await Promise.all([
        apiGet<Client[]>("/api/clients", token),
        apiGet<Transaction[]>("/api/transactions", token),
      ])
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/Dashboard.tsx
git commit -m "feat: migrate Dashboard from supabase to api helpers"
```

---

## Task 13: Update ClientsPage

**Files:**
- Modify: `src/pages/ClientsPage.tsx`

- [ ] **Step 1: Replace import**

Find:
```tsx
import { supabase, type Client, type Transaction } from "@/lib/supabase"
```

Replace with:
```tsx
import { useAuth } from "@clerk/clerk-react"
import { apiGet, apiPost } from "@/lib/api"
import type { Client, Transaction } from "@/lib/types"
```

- [ ] **Step 2: Add getToken to component**

Find:
```tsx
export function ClientsPage() {
  const navigate = useNavigate()
  const [clientsWithStats, setClientsWithStats] = useState<ClientWithStats[]>([])
```

Replace with:
```tsx
export function ClientsPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [clientsWithStats, setClientsWithStats] = useState<ClientWithStats[]>([])
```

- [ ] **Step 3: Replace loadClients**

Find:
```tsx
  async function loadClients() {
    const [clientsRes, txRes] = await Promise.all([
      supabase.from("clients").select("*").order("created_at", { ascending: false }),
      supabase.from("transactions").select("*"),
    ])

    const clients: Client[] = clientsRes.data ?? []
    const transactions: Transaction[] = txRes.data ?? []
```

Replace with:
```tsx
  async function loadClients() {
    const token = await getToken()
    if (!token) return

    const [clients, transactions] = await Promise.all([
      apiGet<Client[]>("/api/clients", token),
      apiGet<Transaction[]>("/api/transactions", token),
    ])
```

- [ ] **Step 4: Replace handleCreate**

Find:
```tsx
  async function handleCreate() {
    if (!form.name.trim()) {
      toast.error("Client name is required")
      return
    }
    setSaving(true)
    const { error } = await supabase.from("clients").insert([form])
    setSaving(false)
    if (error) {
      toast.error("Failed to create client")
      return
    }
    toast.success("Client created")
    setDialogOpen(false)
    setForm(defaultForm)
    loadClients()
  }
```

Replace with:
```tsx
  async function handleCreate() {
    if (!form.name.trim()) {
      toast.error("Client name is required")
      return
    }
    setSaving(true)
    try {
      const token = await getToken()
      await apiPost("/api/clients", token!, form)
      toast.success("Client created")
      setDialogOpen(false)
      setForm(defaultForm)
      loadClients()
    } catch {
      toast.error("Failed to create client")
    } finally {
      setSaving(false)
    }
  }
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/ClientsPage.tsx
git commit -m "feat: migrate ClientsPage from supabase to api helpers"
```

---

## Task 14: Update ClientDetailPage

**Files:**
- Modify: `src/pages/ClientDetailPage.tsx`

- [ ] **Step 1: Replace import**

Find:
```tsx
import { supabase, type Client, type Transaction } from "@/lib/supabase"
```

Replace with:
```tsx
import { useAuth } from "@clerk/clerk-react"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api"
import type { Client, Transaction } from "@/lib/types"
```

- [ ] **Step 2: Add getToken**

Find:
```tsx
export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [client, setClient] = useState<Client | null>(null)
```

Replace with:
```tsx
export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [client, setClient] = useState<Client | null>(null)
```

- [ ] **Step 3: Replace loadData**

Find:
```tsx
  const loadData = useCallback(async () => {
    if (!id) return
    const [clientRes, txRes] = await Promise.all([
      supabase.from("clients").select("*").eq("id", id).maybeSingle(),
      supabase.from("transactions").select("*").eq("client_id", id).order("date", { ascending: false }),
    ])
    if (!clientRes.data) { navigate("/clients"); return }
    setClient(clientRes.data)
    setTransactions(txRes.data ?? [])
    setLoading(false)
  }, [id, navigate])
```

Replace with:
```tsx
  const loadData = useCallback(async () => {
    if (!id) return
    try {
      const token = await getToken()
      if (!token) return
      const [clientData, txData] = await Promise.all([
        apiGet<Client>(`/api/clients/${id}`, token),
        apiGet<Transaction[]>(`/api/transactions?clientId=${id}`, token),
      ])
      setClient(clientData)
      setTransactions(txData)
      setLoading(false)
    } catch {
      navigate("/clients")
    }
  }, [id, navigate, getToken])
```

- [ ] **Step 4: Replace handleAddTransaction**

Find:
```tsx
  const handleAddTransaction = async () => {
    if (!txForm.amount || isNaN(parseFloat(txForm.amount))) { toast.error("Valid amount is required"); return }
    setSaving(true)
    const { error } = await supabase.from("transactions").insert([{ client_id: id, type: txForm.type, amount: parseFloat(txForm.amount), description: txForm.description, category: txForm.category, date: txForm.date }])
    setSaving(false)
    if (error) { toast.error("Failed to add transaction"); return }
    toast.success(`${txForm.type === "incoming" ? "Income" : "Expense"} added`)
    setTxDialogOpen(false)
    setTxForm(defaultTxForm)
    loadData()
  }
```

Replace with:
```tsx
  const handleAddTransaction = async () => {
    if (!txForm.amount || isNaN(parseFloat(txForm.amount))) { toast.error("Valid amount is required"); return }
    setSaving(true)
    try {
      const token = await getToken()
      await apiPost("/api/transactions", token!, {
        client_id: id, type: txForm.type, amount: parseFloat(txForm.amount),
        description: txForm.description, category: txForm.category, date: txForm.date,
      })
      toast.success(`${txForm.type === "incoming" ? "Income" : "Expense"} added`)
      setTxDialogOpen(false)
      setTxForm(defaultTxForm)
      loadData()
    } catch {
      toast.error("Failed to add transaction")
    } finally {
      setSaving(false)
    }
  }
```

- [ ] **Step 5: Replace handleEditTransaction**

Find:
```tsx
  const handleEditTransaction = async () => {
    if (!editTxForm || !editTxForm.amount || isNaN(parseFloat(editTxForm.amount))) { toast.error("Valid amount is required"); return }
    setSaving(true)
    const { error } = await supabase.from("transactions").update({ type: editTxForm.type, amount: parseFloat(editTxForm.amount), description: editTxForm.description, category: editTxForm.category, date: editTxForm.date }).eq("id", editTxForm.id)
    setSaving(false)
    if (error) { toast.error("Failed to update transaction"); return }
    toast.success("Transaction updated")
    setEditTxDialogOpen(false)
    setEditTxForm(null)
    loadData()
  }
```

Replace with:
```tsx
  const handleEditTransaction = async () => {
    if (!editTxForm || !editTxForm.amount || isNaN(parseFloat(editTxForm.amount))) { toast.error("Valid amount is required"); return }
    setSaving(true)
    try {
      const token = await getToken()
      await apiPatch(`/api/transactions/${editTxForm.id}`, token!, {
        type: editTxForm.type, amount: parseFloat(editTxForm.amount),
        description: editTxForm.description, category: editTxForm.category, date: editTxForm.date,
      })
      toast.success("Transaction updated")
      setEditTxDialogOpen(false)
      setEditTxForm(null)
      loadData()
    } catch {
      toast.error("Failed to update transaction")
    } finally {
      setSaving(false)
    }
  }
```

- [ ] **Step 6: Replace handleEditClient**

Find:
```tsx
  const handleEditClient = async () => {
    if (!clientForm || !client) return
    setSaving(true)
    const { error } = await supabase.from("clients").update(clientForm).eq("id", client.id)
    setSaving(false)
    if (error) { toast.error("Failed to update client"); return }
    toast.success("Client updated")
    setEditClientDialogOpen(false)
    setClient({ ...client, ...clientForm })
  }
```

Replace with:
```tsx
  const handleEditClient = async () => {
    if (!clientForm || !client) return
    setSaving(true)
    try {
      const token = await getToken()
      await apiPatch(`/api/clients/${client.id}`, token!, clientForm)
      toast.success("Client updated")
      setEditClientDialogOpen(false)
      setClient({ ...client, ...clientForm })
    } catch {
      toast.error("Failed to update client")
    } finally {
      setSaving(false)
    }
  }
```

- [ ] **Step 7: Replace handleDelete**

Find:
```tsx
  const handleDelete = async () => {
    if (!deleteId || !deleteType) return
    if (deleteType === "transaction") {
      await supabase.from("transactions").delete().eq("id", deleteId)
      toast.success("Transaction deleted")
    } else {
      await supabase.from("clients").delete().eq("id", client?.id)
      toast.success("Client deleted")
      navigate("/clients")
      return
    }
    setDeleteId(null)
    setDeleteType(null)
    loadData()
  }
```

Replace with:
```tsx
  const handleDelete = async () => {
    if (!deleteId || !deleteType) return
    try {
      const token = await getToken()
      if (deleteType === "transaction") {
        await apiDelete(`/api/transactions/${deleteId}`, token!)
        toast.success("Transaction deleted")
        setDeleteId(null)
        setDeleteType(null)
        loadData()
      } else {
        await apiDelete(`/api/clients/${client?.id}`, token!)
        toast.success("Client deleted")
        navigate("/clients")
      }
    } catch {
      toast.error("Delete failed")
    }
  }
```

- [ ] **Step 8: Commit**

```bash
git add src/pages/ClientDetailPage.tsx
git commit -m "feat: migrate ClientDetailPage from supabase to api helpers"
```

---

## Task 15: Update ProfilePage

**Files:**
- Modify: `src/pages/ProfilePage.tsx`

- [ ] **Step 1: Replace the entire file**

Replace the entire content of `src/pages/ProfilePage.tsx`:

```tsx
import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth, useUser, useClerk } from "@clerk/clerk-react"
import { apiGet, apiPatch } from "@/lib/api"
import type { UserProfile } from "@/lib/types"
import { CURRENCIES } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { ArrowLeft, Loader as Loader2, LogOut } from "lucide-react"

export function ProfilePage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { user } = useUser()
  const { signOut } = useClerk()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fullName, setFullName] = useState("")
  const [currency, setCurrency] = useState("USD")

  useEffect(() => {
    async function loadProfile() {
      const token = await getToken()
      if (!token) return
      try {
        const data = await apiGet<UserProfile>("/api/profile", token)
        setProfile(data)
        setFullName(data.full_name ?? "")
        setCurrency(data.currency ?? "USD")
      } catch {
        toast.error("Failed to load profile")
      } finally {
        setLoading(false)
      }
    }
    loadProfile()
  }, [getToken])

  const handleSave = async () => {
    if (!profile) return
    setSaving(true)
    try {
      const token = await getToken()
      await apiPatch("/api/profile", token!, { full_name: fullName, currency })
      setProfile({ ...profile, full_name: fullName, currency })
      toast.success("Profile updated successfully")
    } catch {
      toast.error("Failed to save profile")
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = async () => {
    await signOut()
    toast.success("Logged out successfully")
    navigate("/login")
  }

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!profile) return null

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} className="-ml-2">
        <ArrowLeft className="size-4" />
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Profile Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Email</Label>
            <div className="px-3 py-2 rounded-md border bg-muted text-sm">
              {user?.primaryEmailAddress?.emailAddress ?? profile.email}
            </div>
            <p className="text-xs text-muted-foreground">Email cannot be changed</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="currency">Default Currency</Label>
            <p className="text-xs text-muted-foreground">This currency will be used for all transactions and dashboards</p>
            <Select value={currency} onValueChange={setCurrency} disabled={saving}>
              <SelectTrigger id="currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((curr) => (
                  <SelectItem key={curr} value={curr}>{curr}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleSave} className="w-full" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/20 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-destructive">Logout</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">Sign out of your ProfitSync account</p>
          <Button variant="destructive" onClick={handleLogout} className="w-full">
            <LogOut className="size-4 mr-2" />
            Logout
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/ProfilePage.tsx
git commit -m "feat: migrate ProfilePage from supabase to Clerk + api helpers"
```

---

## Task 16: Delete Supabase Files

**Files:**
- Delete: `src/lib/supabase.ts`
- Delete: `supabase/` directory

- [ ] **Step 1: Remove supabase.ts**

```bash
rm src/lib/supabase.ts
```

- [ ] **Step 2: Archive supabase/ directory (keep migrations for reference)**

```bash
mv supabase supabase.bak
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
npm run typecheck
```

Expected: zero errors. If any errors about missing types or supabase imports appear, they indicate a file was missed in Tasks 12–15 — fix the remaining import.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove supabase.ts and archive supabase/ directory"
```

---

## Task 17: Set Up Environment and Push Schema to Neon

**Files:**
- Create: `.env.local`

- [ ] **Step 1: Create .env.local**

Create `.env.local` in the project root (never commit this file):

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_<your-clerk-publishable-key>
CLERK_SECRET_KEY=sk_test_<your-clerk-secret-key>
DATABASE_URL=postgresql://<user>:<password>@<host>.neon.tech/<dbname>?sslmode=require
```

Fill in real values from:
- Clerk dashboard → API Keys
- Neon dashboard → Connection string (use the **pooled** connection string)

- [ ] **Step 2: Verify .env.local is gitignored**

```bash
cat .gitignore | grep env
```

Expected: `.env.local` or `*.local` appears. If not, add it:

```bash
echo ".env.local" >> .gitignore
git add .gitignore
git commit -m "chore: ensure .env.local is gitignored"
```

- [ ] **Step 3: Push schema to Neon**

```bash
npm run db:push
```

Expected output similar to:
```
[✓] Changes applied:
  - Created table clients
  - Created table transactions
  - Created table user_profiles
```

If you see `DATABASE_URL is not set`, check that `.env.local` is in the project root and has the correct variable name.

---

## Task 18: Install Vercel CLI and Run Locally

- [ ] **Step 1: Install Vercel CLI globally (if not already installed)**

```bash
npm i -g vercel
```

Verify: `vercel --version` should print a version number.

- [ ] **Step 2: Link the project to Vercel**

```bash
vercel link
```

Follow prompts: select your Vercel account, create a new project (or link existing). Accept defaults for the framework (Vite).

- [ ] **Step 3: Run dev server**

```bash
vercel dev
```

Expected: Vercel CLI reads `.env.local`, starts both the Vite frontend and the `api/` serverless functions on `http://localhost:3000`.

- [ ] **Step 4: Test the golden path**

1. Open `http://localhost:3000`
2. You should be redirected to `/login` — Clerk's sign-in UI should appear
3. Create an account via `/signup`
4. After sign-up you should land on `/dashboard`
5. Navigate to Clients → create a client → verify it appears
6. Click the client → add a transaction → verify it appears
7. Navigate to Profile → verify your email shows, save a name change
8. Logout → verify you're redirected to login and can't access `/dashboard`

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete supabase→clerk+neon migration, runs on vercel dev"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Auth: Clerk SignIn/SignUp embedded, handles OTP and password reset natively (§3.1)
- ✅ API JWT verification: `clerk.verifyToken()` in every handler (§3.2)
- ✅ User profiles: upsert on first GET (§3.3)
- ✅ Schema: `user_id` on clients, text PK on user_profiles (§4)
- ✅ Drizzle client: neon-http driver (§5)
- ✅ All 5 API routes created (§6)
- ✅ Frontend api.ts helpers (§7)
- ✅ Local dev via `vercel dev` (§8)
- ✅ Schema pushed via drizzle-kit (§9)

**Type consistency:**
- `apiGet<Client[]>`, `apiGet<Transaction[]>`, `apiGet<UserProfile>` — types from `src/lib/types.ts`
- API routes return snake_case JSON (Drizzle camelCase columns are mapped via column names like `"user_id"` matching the SQL column exactly)
- Note: Drizzle returns camelCase keys in JS (e.g. `userId`, `createdAt`). The `Client` type in `types.ts` uses snake_case (`user_id`, `created_at`). The frontend pages reference `client_id`, `created_at` etc. To avoid a mismatch, the API routes use `.returning()` which returns Drizzle objects — these will have camelCase keys. **Fix**: in each API route, use `res.json(row)` and rely on Drizzle's returned object shape, then update `types.ts` to use camelCase, OR add a serialization step. The simpler fix is to keep `types.ts` in snake_case and add a small serializer in each route.

**Serializer fix** — add this helper to `src/lib/db/index.ts` (exported for API use):

```ts
// Converts Drizzle's camelCase output to snake_case for frontend compatibility
export function serialize<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/([A-Z])/g, "_$1").toLowerCase(),
      v,
    ])
  )
}
```

Then in each API route, wrap `.returning()` results:
```ts
import { db, serialize } from "../src/lib/db"
// ...
const [row] = await db.insert(clients).values(...).returning()
return res.json(serialize(row))
```

This is a necessary fix — add `serialize` to `src/lib/db/index.ts` and apply it to all `.returning()` results and `.select()` results in all 5 API routes **before** running Task 18.
