import type { WealthAccount } from "@/lib/types"
import type { Allocation } from "@/components/AccountSelector"

export type TxForm = {
  client_id: string
  // One allocation per account. A single entry can be split across several
  // accounts; each allocation is saved as its own transaction row upstream.
  allocations: Allocation[]
  type: "incoming" | "outgoing"
  // 'refund' = money back for an earlier expense (always incoming): reporting
  // nets it against expense, never income. See src/lib/tx-classify.ts.
  kind: "standard" | "refund"
  description: string
  category: string
  // Committed tags + the free-typed draft (committed on Enter/comma/blur/save).
  tags: string[]
  tag_draft: string
  date: string
}

export const defaultTxForm = (): TxForm => ({
  client_id: "",
  allocations: [],
  type: "incoming",
  kind: "standard",
  description: "",
  category: "",
  tags: [],
  tag_draft: "",
  date: new Date().toISOString().split("T")[0],
})

// Cash in Hand is the default source; fall back to the first account.
export const defaultAccountId = (accounts: WealthAccount[]) =>
  accounts.find((a) => a.type === "cash")?.id ?? accounts[0]?.id ?? ""

// Seed the edit form from a row: its account and, when a card paid, that card
// (so the picker highlights the card tile and a save keeps the attribution).
export const allocationFor = (
  tx: { wealth_account_id?: string | null; card_id?: string | null; amount: number },
  accounts: WealthAccount[],
): Allocation[] => [{
  account_id: tx.wealth_account_id ?? defaultAccountId(accounts),
  card_id: tx.wealth_account_id ? (tx.card_id ?? null) : null,
  amount: String(tx.amount),
}]

// The wire shape of one allocation for POST /api/transactions/group and the
// split re-create: the server forces wealth_account_id to the card's account.
export const allocationPayload = (a: Allocation) => ({
  wealth_account_id: a.account_id,
  card_id: a.card_id ?? null,
  amount: parseFloat(a.amount),
})

// Did the server refuse the leg because its card can't take new payments?
// (api/_lib/cards.ts resolveCardForLeg — "frozen" / "closed" / archived.)
export function isCardUnusableError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : ""
  let message = text
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    if (parsed && typeof parsed.error === "string") message = parsed.error
  } catch {
    /* plain text */
  }
  return /\bcard\b/i.test(message) && /frozen|closed|archived/i.test(message)
}

export const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Upload one file as an attachment on a transaction (base64 JSON, same as the page). */
export function uploadTxAttachment(file: File, txId: string, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1]
      const res = await fetch(`/api/transactions/${txId}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          file_name: file.name,
          file_type: file.type || "application/octet-stream",
          file_size: file.size,
          file_data: base64,
        }),
      })
      if (!res.ok) reject(new Error("Upload failed"))
      else resolve()
    }
    reader.onerror = () => reject(new Error("Failed to read file"))
    reader.readAsDataURL(file)
  })
}
