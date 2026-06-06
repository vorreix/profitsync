// Shape + helpers for the bank-account form, kept in a plain module so the create
// and edit dialogs share one definition (and React Fast Refresh stays happy).

export type BankFormState = {
  bank_name: string
  nickname: string
  icon: string
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
  bank_name: "", nickname: "", icon: "bank", brand_domain: "", logo_url: "",
  country: "", account_number: "", routing_number: "", swift: "",
  address: "", location: "", note: "",
}

/** Build a form state from a saved account (for the edit dialog). */
export function bankFormFromAccount(a: {
  bank_name: string; nickname: string; icon: string
  brand_domain?: string; logo_url?: string; country?: string
  account_number?: string; routing_number?: string; swift?: string
  address?: string; location?: string; note?: string
}): BankFormState {
  return {
    bank_name: a.bank_name, nickname: a.nickname, icon: a.icon || "bank",
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
