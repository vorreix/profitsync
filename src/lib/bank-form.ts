import { accountColorStyle, type AccountColorStyle } from "./account-color"

// Shape + helpers for the bank-account form, kept in a plain module so the create
// and edit dialogs share one definition (and React Fast Refresh stays happy).

export type BankFormState = {
  bank_name: string
  nickname: string
  icon: string
  // Colour identity (src/lib/account-color.ts). "" = AUTO.
  color: string
  color_style: AccountColorStyle
  brand_domain: string
  logo_url: string
  country: string
  account_number: string
  routing_number: string
  swift: string
  address: string
  location: string
  note: string
}

export const emptyBankForm: BankFormState = {
  bank_name: "", nickname: "", icon: "bank", color: "", color_style: "subtle", brand_domain: "", logo_url: "",
  country: "", account_number: "", routing_number: "", swift: "",
  address: "", location: "", note: "",
}

/** Build a form state from a saved account (for the edit dialog). */
export function bankFormFromAccount(a: {
  bank_name: string; nickname: string; icon: string
  color?: string; color_style?: string
  brand_domain?: string; logo_url?: string; country?: string
  account_number?: string; routing_number?: string; swift?: string
  address?: string; location?: string; note?: string
}): BankFormState {
  return {
    bank_name: a.bank_name, nickname: a.nickname, icon: a.icon || "bank",
    color: a.color ?? "", color_style: accountColorStyle(a.color_style),
    brand_domain: a.brand_domain ?? "", logo_url: a.logo_url ?? "", country: a.country ?? "",
    account_number: a.account_number ?? "", routing_number: a.routing_number ?? "", swift: a.swift ?? "",
    address: a.address ?? "", location: a.location ?? "", note: a.note ?? "",
  }
}

/** The snake_case bank-detail payload sent to the API on create/update. */
export function bankDetailsPayload(f: BankFormState) {
  return {
    brand_domain: f.brand_domain,
    logo_url: f.logo_url,
    country: f.country,
    account_number: f.account_number,
    routing_number: f.routing_number,
    swift: f.swift,
    address: f.address,
    location: f.location,
    note: f.note,
  }
}

/** The appearance payload sent alongside every account create/update. */
export function appearancePayload(f: BankFormState) {
  return { color: f.color, color_style: f.color_style }
}
