import type { WealthAccount } from "@/lib/types"
import type { Allocation } from "@/components/AccountSelector"

export type TxForm = {
  client_id: string
  // One allocation per account. A single entry can be split across several
  // accounts; each allocation is saved as its own transaction row upstream.
  allocations: Allocation[]
  type: "incoming" | "outgoing"
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
  description: "",
  category: "",
  tags: [],
  tag_draft: "",
  date: new Date().toISOString().split("T")[0],
})

// Cash in Hand is the default source; fall back to the first account.
export const defaultAccountId = (accounts: WealthAccount[]) =>
  accounts.find((a) => a.type === "cash")?.id ?? accounts[0]?.id ?? ""

export const allocationFor = (
  tx: { wealth_account_id?: string | null; amount: number },
  accounts: WealthAccount[],
): Allocation[] => [{ account_id: tx.wealth_account_id ?? defaultAccountId(accounts), amount: String(tx.amount) }]

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
