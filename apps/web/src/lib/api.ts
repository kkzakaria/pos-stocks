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
      details?: {
        fieldErrors?: Record<string, string[]>
        formErrors?: string[]
      }
    } | null
    // Message de validation détaillé (fieldErrors/formErrors) en priorité,
    // sinon le message générique de l'enveloppe, sinon le statut HTTP.
    const premierChampErreur = Object.values(
      body?.details?.fieldErrors ?? {}
    ).find((messages) => messages.length > 0)?.[0]
    const premierFormErreur = body?.details?.formErrors?.[0]
    throw new Error(
      premierChampErreur ??
        premierFormErreur ??
        body?.message ??
        `Erreur ${res.status}`
    )
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

// URL absolue vers l'API (les <img> ne passent pas par apiFetch)
export function apiUrl(path: string): string {
  return `${base}${path}`
}
