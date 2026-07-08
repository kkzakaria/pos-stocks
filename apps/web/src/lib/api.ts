const base = import.meta.env.VITE_API_URL || ""

export async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${base}${path}`, { credentials: "include", ...init })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string
    } | null
    throw new Error(body?.message ?? `Erreur ${res.status}`)
  }
  return res.json() as Promise<T>
}
