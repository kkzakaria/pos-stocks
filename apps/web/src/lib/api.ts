const base = import.meta.env.VITE_API_URL || ""

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = 15000
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      credentials: "include",
      signal: controller.signal,
      ...init,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("La requête a expiré, veuillez réessayer.")
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string
    } | null
    throw new Error(body?.message ?? `Erreur ${res.status}`)
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}
