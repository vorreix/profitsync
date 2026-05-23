import { createClient } from "@supabase/supabase-js"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Client = {
  id: string
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

export type TransactionAttachment = {
  id: string
  transaction_id: string
  file_name: string
  file_url: string
  file_size: number
  created_at: string
}

export type UserProfile = {
  id: string
  email: string
  full_name: string
  currency: string
  created_at: string
  updated_at: string
}

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "INR", "CHF", "CNY", "SEK", "NZD"]

export { CURRENCIES }
