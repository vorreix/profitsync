export type Client = {
  id: string
  user_id: string
  name: string
  company: string
  email: string
  phone: string
  status: "active" | "inactive" | "archived"
  notes: string
  onboard_date?: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  total_incoming?: number
  total_outgoing?: number
}

export type TransactionAttachment = {
  id: string
  transaction_id: string
  user_id: string
  file_name: string
  file_type: string
  file_size: number
  created_at: string
}

export type Transaction = {
  id: string
  client_id: string
  client_name?: string
  type: "incoming" | "outgoing"
  amount: number
  description: string
  category: string
  date: string
  created_at: string
  updated_at: string
}

export type Quotation = {
  id: string
  user_id: string
  title: string
  prospect_name: string
  company: string
  email: string
  phone: string
  amount: string
  status: "draft" | "sent" | "accepted" | "rejected"
  notes: string
  linked_client_id: string | null
  deleted_at: string | null
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
