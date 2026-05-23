# ProfitSync — Product Specification

## 1. Overview

ProfitSync is a business finance management app that helps businesses understand how much they earn, spend, and profit from each client. Users manage multiple clients, track income and expenses per client, create quotations with full revision history, and monitor profitability through individual client views and an overall dashboard.

**Design direction:** Modern, clean, simple, and professional.

---

## 2. Core Concepts

| Concept | Description |
|---|---|
| **Client** | A business relationship the user tracks. Has its own profile, transactions, quotations, notes, files, and activity history. |
| **Transaction** | An income (incoming payment) or expense (outgoing) recorded under a client. Supports attachments. |
| **Quotation** | A priced proposal sent to a client, with full revision/history tracking. |
| **Tag** | A label used to organize and filter clients and transactions. |
| **Currency** | A user-level default that applies across all clients and the dashboard. |

---

## 3. Authentication & Account

The app includes a complete authentication flow:

- **Sign up** — create a new account.
- **Login** — standard email/password sign-in.
- **Login OTP verification** — a one-time code is sent by email to verify login.
- **Forgot password** — request a reset via email.
- **Reset password** — set a new password from the emailed link.

---

## 4. User Profile & Settings

A dedicated user profile section where the user can:

- View and edit their own profile details.
- **Select a default currency.** This currency:
  - Becomes the default for all clients.
  - Drives how all client data is displayed.
  - Drives all dashboard figures (revenue, expenses, net profit, summaries).

---

## 5. Clients

### 5.1 Client list
- Create and manage multiple clients.
- Each client is shown as a **card** that surfaces key financials at a glance:
  - Total income
  - Total expenses
  - Profit / loss
- Edit client details.

### 5.2 Client profile (drill-in)
Clicking a client card opens that client's full profile, where the user can track:

- **Incoming payments** (add new income)
- **Expenses** (add new outgoings)
- **Quotations**
- **Notes**
- **Files**
- **Activity history**
- **Profit / loss** for that client

---

## 6. Transactions (Income & Expenses)

Within a client profile, the user can:

- **Add** incoming payments and outgoing expenses.
- **Edit** existing transactions.
- **Add attachments** to a transaction (e.g. receipts, invoices).
- **Search** transactions within the client.

Each client's totals (income, expense, profit/loss) update automatically based on its transactions and are reflected on the client card.

---

## 7. Quotations

Quotations have their own lifecycle and are not only nested inside a client.

### 7.1 Core
- Create quotations.
- Maintain **full revision / history tracking** so every version of a quotation is preserved and viewable.
- **Search quotations** to quickly find them.

### 7.2 Status & conversion
- Each quotation has a **status**: **Won** or **Not Won**.
- A **Won** quotation can be **converted into a client** — the quote becomes (or links to) a client record.
- From the quotation, the user can **navigate to the linked client**, and the relationship is traceable both ways.

---

## 8. Dashboard

The overall dashboard provides a top-level financial view:

- **Total revenue**
- **Total expenses**
- **Net profit**
- **Client analytics**
- **Financial summaries**

### 8.1 Client filtering
- A **search box in the filter** lets the user find clients by name.
- **Multi-select** clients to view an **aggregated dashboard** — totals and analytics combine across only the selected clients.
- All dashboard figures respect the user's default currency.

---

## 9. Search, Filter & Tags

- Use **tags** to organize clients and transactions.
- Search and filter across the app to quickly find clients, transactions, and quotations.

---

## 10. Feature Summary

| Area | Capabilities |
|---|---|
| **Auth** | Sign up, login, login OTP (email), forgot password, reset password |
| **Profile** | Edit profile, set default currency (applies app-wide) |
| **Clients** | Create, edit, list as cards with income/expense/profit, drill into profile |
| **Client profile** | Incoming payments, expenses, quotations, notes, files, activity history, profit/loss |
| **Transactions** | Add income/expense, edit, attachments, search |
| **Quotations** | Create + full revision/history tracking; searchable; Won / Not Won status; convert a won quote into a client with two-way navigation |
| **Dashboard** | Total revenue, expenses, net profit, analytics, summaries; client search + multi-select aggregation |
| **Organization** | Tags, search, filtering across clients and transactions |
| **Currency** | User-level default reflected in client data and dashboard |