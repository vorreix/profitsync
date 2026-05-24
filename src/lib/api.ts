let activeOrgId: string | null = null

export function setActiveOrgId(id: string | null) {
  activeOrgId = id
}

export function getActiveOrgId(): string | null {
  return activeOrgId
}

async function request<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(activeOrgId ? { "x-org-id": activeOrgId } : {}),
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
