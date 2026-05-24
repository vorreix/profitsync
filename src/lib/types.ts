export type Client = {
  id: string
  user_id: string
  organization_id?: string | null
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

export type QuotationAttachment = {
  id: string
  quotation_id: string
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
  organization_id?: string | null
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
  current_organization_id: string | null
  terms_accepted_at: string | null
  created_at: string
  updated_at: string
}

export type OrgRole = "owner" | "admin" | "editor" | "viewer"

export type Organization = {
  id: string
  owner_user_id: string
  name: string
  slug: string
  is_personal: boolean
  currency: string
  role: OrgRole
  plan_key: string | null
  plan_status: string | null
  created_at: string
  updated_at: string
}

export const CURRENCIES = [
  "USD", "EUR", "GBP", "CAD", "AUD", "JPY",
  "INR", "CHF", "CNY", "SEK", "NZD",
]

export const LEGAL_DOC_VERSION = "1.0.0"
