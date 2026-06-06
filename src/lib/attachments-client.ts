// Client-side attachment helpers. The server (api/_lib/attachments.ts) is the
// authoritative gate — these mirror its allowlist and size cap purely for fast,
// friendly feedback before an upload is attempted.

export type AttachmentParent = "client" | "transaction" | "quotation" | "wealth_account"

// Mirror of the server's extension allowlist.
export const ALLOWED_EXTENSIONS = [
  "jpg", "jpeg", "png", "gif", "webp", "heic",
  "pdf", "txt", "csv",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
] as const

// `accept` attribute for the file picker (extensions only — most reliable across
// browsers/OSes).
export const ACCEPT_ATTR = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",")

// Absolute per-file cap, matching the server. base64 in a JSON body must also
// fit under Vercel's request body limit, so this stays conservative.
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ""
}

// Returns an error message if the file is not acceptable, or null if it's fine.
export function validateFile(file: File): string | null {
  const ext = extensionOf(file.name)
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return `"${file.name}" isn't an allowed file type.`
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `"${file.name}" is too large (max ${(MAX_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(0)}MB).`
  }
  if (file.size === 0) return `"${file.name}" is empty.`
  return null
}

const LIST_BASE: Record<AttachmentParent, string> = {
  client: "clients",
  transaction: "transactions",
  quotation: "quotations",
  wealth_account: "wealth/accounts",
}

const ITEM_BASE: Record<AttachmentParent, string> = {
  client: "client-attachments",
  transaction: "attachments",
  quotation: "quotation-attachments",
  wealth_account: "wealth-account-attachments",
}

// List + upload endpoint for a parent record.
export function attachmentsListPath(type: AttachmentParent, parentId: string): string {
  return `/api/${LIST_BASE[type]}/${parentId}/attachments`
}

// Download + delete endpoint for a single attachment.
export function attachmentItemPath(type: AttachmentParent, attachmentId: string): string {
  return `/api/${ITEM_BASE[type]}/${attachmentId}`
}

// Shape of the editable metadata returned by `?metadata=1` and accepted by PATCH.
export type AttachmentMetadata = {
  id: string
  file_name: string
  file_type: string
  file_size: number
  display_name?: string | null
  tags?: string[]
  category?: string
  created_at?: string
  updated_at?: string
  transaction_id?: string
  quotation_id?: string
  client_id?: string
}

// Fetch a single attachment's metadata (never the file bytes) — used by the
// detail modal, including deep-linked opens where the row isn't already loaded.
export async function fetchAttachmentMeta(
  type: AttachmentParent,
  attachmentId: string,
  token: string,
): Promise<AttachmentMetadata> {
  const res = await fetch(`${attachmentItemPath(type, attachmentId)}?metadata=1`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error("Failed to load attachment")
  return (await res.json()) as AttachmentMetadata
}

// Fetch the raw file as a Blob (for inline preview or download), authenticated.
export async function fetchAttachmentBlob(
  type: AttachmentParent,
  attachmentId: string,
  token: string,
): Promise<Blob> {
  const res = await fetch(attachmentItemPath(type, attachmentId), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error("Failed to load file")
  return await res.blob()
}

// Read a file as base64 and POST it to `path`. Resolves on success, rejects with
// the server's error message otherwise. Validation should be done before calling.
export function uploadAttachment(path: string, file: File, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const base64 = String(reader.result).split(",")[1] ?? ""
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            file_name: file.name,
            file_type: file.type || "application/octet-stream",
            file_size: file.size,
            file_data: base64,
          }),
        })
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string; reason?: string }
          reject(new Error(err.error || err.reason || "Upload failed"))
          return
        }
        resolve()
      } catch (e) {
        reject(e instanceof Error ? e : new Error("Upload failed"))
      }
    }
    reader.onerror = () => reject(new Error("Failed to read file"))
    reader.readAsDataURL(file)
  })
}
