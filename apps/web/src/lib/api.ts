const base = import.meta.env.VITE_API_URL || ""

// Erreur API typée : les écrans qui ont besoin du code stable et des
// details (ex. POS : 409 STOCK_INSUFFISANT → lignes en alerte) les lisent
// ici ; les onError existants continuent de lire err.message tel quel.
export class ApiError extends Error {
  readonly status: number
  readonly code: string | null
  readonly details: unknown

  constructor(
    message: string,
    status: number,
    code: string | null,
    details: unknown
  ) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.details = details
  }
}

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
      code?: string
      message?: string
      details?: unknown
    } | null
    // Message de validation détaillé (fieldErrors/formErrors) en priorité,
    // sinon le message générique de l'enveloppe, sinon le statut HTTP.
    const details = body?.details as
      | { fieldErrors?: Record<string, string[]>; formErrors?: string[] }
      | undefined
    const premierChampErreur = Object.values(details?.fieldErrors ?? {}).find(
      (messages) => messages.length > 0
    )?.[0]
    const premierFormErreur = details?.formErrors?.[0]
    throw new ApiError(
      premierChampErreur ??
        premierFormErreur ??
        body?.message ??
        `Erreur ${res.status}`,
      res.status,
      body?.code ?? null,
      body?.details ?? null
    )
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

// URL absolue vers l'API (les <img> ne passent pas par apiFetch)
export function apiUrl(path: string): string {
  return `${base}${path}`
}
